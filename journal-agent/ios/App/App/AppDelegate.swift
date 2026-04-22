import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

@objc(AppViewController)
class AppViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(WeatherSymbolsPlugin())
    }
}

@objc(WeatherSymbolsPlugin)
class WeatherSymbolsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WeatherSymbolsPlugin"
    public let jsName = "WeatherSymbols"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "renderSymbol", returnType: CAPPluginReturnPromise)
    ]

    @objc func renderSymbol(_ call: CAPPluginCall) {
        guard let name = call.getString("name"), !name.isEmpty else {
            call.reject("Weather symbol name is required.")
            return
        }

        let pointSize = CGFloat(call.getDouble("pointSize") ?? 48)
        let weight = symbolWeight(from: call.getString("weight"))
        let scale = symbolScale(from: call.getString("scale"))
        let tintColor = color(from: call.getString("tintColor") ?? "#FFFFFF")
        let configuration = UIImage.SymbolConfiguration(
            pointSize: pointSize,
            weight: weight,
            scale: scale
        )

        guard let baseImage = UIImage(systemName: name, withConfiguration: configuration) else {
            call.reject("Unable to load SF Symbol \(name).")
            return
        }

        let tintedImage = baseImage.withTintColor(tintColor, renderingMode: .alwaysOriginal)

        guard let imageData = tintedImage.pngData() else {
            call.reject("Unable to render SF Symbol \(name).")
            return
        }

        call.resolve([
            "dataUrl": "data:image/png;base64,\(imageData.base64EncodedString())"
        ])
    }

    private func symbolWeight(from rawValue: String?) -> UIImage.SymbolWeight {
        switch rawValue {
        case "ultraLight":
            return .ultraLight
        case "thin":
            return .thin
        case "light":
            return .light
        case "medium":
            return .medium
        case "semibold":
            return .semibold
        case "bold":
            return .bold
        default:
            return .regular
        }
    }

    private func symbolScale(from rawValue: String?) -> UIImage.SymbolScale {
        switch rawValue {
        case "small":
            return .small
        case "large":
            return .large
        default:
            return .medium
        }
    }

    private func color(from hex: String) -> UIColor {
        let normalizedHex = hex
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "#", with: "")

        var hexNumber: UInt64 = 0
        Scanner(string: normalizedHex).scanHexInt64(&hexNumber)

        let red: CGFloat
        let green: CGFloat
        let blue: CGFloat
        let alpha: CGFloat

        if normalizedHex.count == 8 {
            red = CGFloat((hexNumber & 0xFF000000) >> 24) / 255
            green = CGFloat((hexNumber & 0x00FF0000) >> 16) / 255
            blue = CGFloat((hexNumber & 0x0000FF00) >> 8) / 255
            alpha = CGFloat(hexNumber & 0x000000FF) / 255
        } else {
            red = CGFloat((hexNumber & 0xFF0000) >> 16) / 255
            green = CGFloat((hexNumber & 0x00FF00) >> 8) / 255
            blue = CGFloat(hexNumber & 0x0000FF) / 255
            alpha = 1
        }

        return UIColor(red: red, green: green, blue: blue, alpha: alpha)
    }
}
