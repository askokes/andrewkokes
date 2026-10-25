import BackgroundTasks
import SwiftUI
import UIKit

/// Where the app lives. The web app at this address is the whole interface; this shell adds Apple Health.
enum AppConfig {
    static let host = "food.pivotaiglobal.com"
    static let url = URL(string: "https://\(host)/")!
    /// The background refresh that syncs Apple Health when HealthKit hasn't woken the app for a while.
    static let refreshTask = "com.pivotaiglobal.foodtracker.sync"
    /// The page's background color, so nothing flashes white while it loads.
    static let background = UIColor(red: 0xf6 / 255, green: 0xf7 / 255, blue: 0xf4 / 255, alpha: 1)
}

@main
struct FoodTrackerApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            WebView(url: AppConfig.url)
                .ignoresSafeArea()
                .background(Color(AppConfig.background))
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                // Opening the app is a good moment: the phone is unlocked, so Health can be read.
                Task { _ = await HealthSync.shared.sync(force: false) }
            case .background:
                AppDelegate.scheduleRefresh()
            default:
                break
            }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // HealthKit wakes the app in the background when new samples arrive, but only for observer
        // queries set up during launch. Start them every launch.
        Task { await HealthSync.shared.startObserving() }

        BGTaskScheduler.shared.register(forTaskWithIdentifier: AppConfig.refreshTask, using: nil) { task in
            guard let task = task as? BGAppRefreshTask else { return task.setTaskCompleted(success: false) }
            AppDelegate.scheduleRefresh()
            let work = Task {
                _ = await HealthSync.shared.sync(force: false)
                task.setTaskCompleted(success: true)
            }
            task.expirationHandler = { work.cancel() }
        }
        return true
    }

    /// Ask iOS for a background refresh in a couple of hours. iOS picks the actual time.
    static func scheduleRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: AppConfig.refreshTask)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 2 * 60 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }
}
