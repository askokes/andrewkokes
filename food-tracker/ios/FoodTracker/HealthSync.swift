import Foundation
import HealthKit

/// Reads the last week's active calories, resting calories and steps from Apple Health and posts them
/// to the food tracker's sync address (POST /api/watch/sync, `days` list) with the person's sync key.
/// Runs when HealthKit has new samples (background delivery), on a background refresh, when the app
/// opens, and when the web app asks (Sync now).
actor HealthSync {
    static let shared = HealthSync()

    /// What the web app is told (web/src/native.ts NativeStatus).
    struct Status {
        var connected: Bool
        var lastSync: String?
        var message: String?

        var dictionary: [String: Any] {
            ["connected": connected, "lastSync": lastSync ?? NSNull(), "message": message ?? NSNull()]
        }
    }

    /// Days sent each time, today included, so a day the phone missed catches up.
    private static let days = 7
    /// Background wake-ups come in bursts; one sync per few minutes is plenty.
    private static let minimumGap: TimeInterval = 5 * 60

    private let store = HKHealthStore()
    private let fields: [(name: String, type: HKQuantityType, unit: HKUnit)] = [
        ("active", HKQuantityType(.activeEnergyBurned), .kilocalorie()),
        ("resting", HKQuantityType(.basalEnergyBurned), .kilocalorie()),
        ("steps", HKQuantityType(.stepCount), .count()),
    ]
    private var observers: [HKObserverQuery] = []
    private var running: Task<Status, Never>?
    private var lastAttempt: Date?

    private let defaults = UserDefaults.standard
    private static let lastSyncKey = "lastSync"
    private static let messageKey = "lastMessage"

    private var isConnected: Bool { Keychain.read("syncKey") != nil && Keychain.read("syncUrl") != nil }

    func status() -> Status {
        Status(connected: isConnected, lastSync: defaults.string(forKey: Self.lastSyncKey), message: defaults.string(forKey: Self.messageKey))
    }

    /// From the Goals tab: keep the key, ask for Health access, start watching, and sync at once.
    func connect(key: String, syncUrl: String) async -> Status {
        guard HKHealthStore.isHealthDataAvailable() else {
            record(message: "Apple Health isn't available on this device.")
            return status()
        }
        Keychain.save("syncKey", key)
        Keychain.save("syncUrl", syncUrl)
        do {
            try await store.requestAuthorization(toShare: [], read: Set(fields.map(\.type)))
        } catch {
            record(message: "Couldn't ask for Health access: \(error.localizedDescription)")
            return status()
        }
        startObserving()
        return await sync(force: true)
    }

    func disconnect() -> Status {
        for query in observers { store.stop(query) }
        observers = []
        store.disableAllBackgroundDelivery { _, _ in }
        Keychain.delete("syncKey")
        Keychain.delete("syncUrl")
        defaults.removeObject(forKey: Self.lastSyncKey)
        defaults.removeObject(forKey: Self.messageKey)
        return status()
    }

    /// Ask HealthKit to wake the app when any of the three gets new samples. Safe to call again.
    func startObserving() {
        guard isConnected, HKHealthStore.isHealthDataAvailable(), observers.isEmpty else { return }
        for field in fields {
            let query = HKObserverQuery(sampleType: field.type, predicate: nil) { _, completion, error in
                guard error == nil else { return completion() }
                Task {
                    _ = await HealthSync.shared.sync(force: false)
                    completion()
                }
            }
            store.execute(query)
            observers.append(query)
            store.enableBackgroundDelivery(for: field.type, frequency: .hourly) { _, _ in }
        }
    }

    /// Send the last week. `force` (Sync now, connecting) skips the few-minute gap.
    func sync(force: Bool) async -> Status {
        if let running { return await running.value }
        guard isConnected else { return status() }
        if !force, let lastAttempt, Date().timeIntervalSince(lastAttempt) < Self.minimumGap { return status() }
        lastAttempt = Date()
        let task = Task { await self.send() }
        running = task
        let result = await task.value
        running = nil
        return result
    }

    private func send() async -> Status {
        guard let key = Keychain.read("syncKey"), let address = Keychain.read("syncUrl"), let url = URL(string: address) else { return status() }
        do {
            let days = try await dailyTotals()
            var request = URLRequest(url: url, timeoutInterval: 30)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: ["key": key, "days": days])
            let (data, response) = try await URLSession.shared.data(for: request)
            let text = String(data: data, encoding: .utf8) ?? ""
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            if code == 200, text.hasPrefix("Synced") {
                defaults.set(ISO8601DateFormatter().string(from: Date()), forKey: Self.lastSyncKey)
                record(message: nil)
            } else if code == 401 {
                record(message: "The sync key isn't right any more. Turn sync off and on again on the Goals tab.")
            } else {
                // A sign-in page instead of the app's answer means Access is blocking the sync path.
                record(message: text.hasPrefix("<") ? "The sync address answered with a sign-in page (HTTP \(code)). Tell Andrew." : "Couldn't sync (HTTP \(code)): \(text.prefix(160))")
            }
        } catch {
            // Health data is locked while the phone is locked: the next unlock or wake-up tries again.
            record(message: "Couldn't sync yet: \(error.localizedDescription)")
        }
        return status()
    }

    private func record(message: String?) {
        if let message { defaults.set(message, forKey: Self.messageKey) } else { defaults.removeObject(forKey: Self.messageKey) }
    }

    /// [{ date: "2026-10-22", active: 707, resting: 2548, steps: 8488 }, ...] for each day with data.
    private func dailyTotals() async throws -> [[String: Any]] {
        let calendar = Calendar.current
        let todayStart = calendar.startOfDay(for: Date())
        guard let start = calendar.date(byAdding: .day, value: -(Self.days - 1), to: todayStart) else { return [] }
        var byDate: [String: [String: Int]] = [:]
        for field in fields {
            for (date, value) in try await sums(of: field.type, unit: field.unit, from: start, anchor: todayStart) {
                byDate[date, default: [:]][field.name] = Int(value.rounded())
            }
        }
        return byDate.keys.sorted().map { date in
            var day: [String: Any] = ["date": date]
            for (name, value) in byDate[date] ?? [:] { day[name] = value }
            return day
        }
    }

    /// Each day's total from `start` to now. HealthKit's statistics query merges the iPhone's and the
    /// Watch's samples without counting the same steps twice.
    private func sums(of type: HKQuantityType, unit: HKUnit, from start: Date, anchor: Date) async throws -> [(String, Double)] {
        try await withCheckedThrowingContinuation { continuation in
            let query = HKStatisticsCollectionQuery(
                quantityType: type,
                quantitySamplePredicate: HKQuery.predicateForSamples(withStart: start, end: nil, options: .strictStartDate),
                options: .cumulativeSum,
                anchorDate: anchor,
                intervalComponents: DateComponents(day: 1)
            )
            query.initialResultsHandler = { _, results, error in
                if let error = error as? HKError, error.code == .errorNoData { return continuation.resume(returning: []) }
                if let error { return continuation.resume(throwing: error) }
                var out: [(String, Double)] = []
                results?.enumerateStatistics(from: start, to: Date()) { statistics, _ in
                    if let sum = statistics.sumQuantity() { out.append((Self.dayString(statistics.startDate), sum.doubleValue(for: unit))) }
                }
                continuation.resume(returning: out)
            }
            store.execute(query)
        }
    }

    private static func dayString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}
