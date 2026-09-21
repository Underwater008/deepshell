import Cocoa
import WebKit

// DeepShell — a native macOS shell for the official DeepSeek Harness web UI.
// Starts the local service if needed (via deepshell.sh ensure) and hosts
// the UI in a WKWebView. No Electron, no telemetry, no dependencies.

let STATE = NSHomeDirectory() + "/Library/Application Support/deepshell"
let SCRIPT = STATE + "/deepshell.sh"
let KEEP_RUNNING = STATE + "/keep-running"

func shellResult(_ command: String, includeErrors: Bool = false) -> (output: String, status: Int32) {
    let task = Process()
    let pipe = Pipe()
    task.executableURL = URL(fileURLWithPath: "/bin/bash")
    task.arguments = ["-l", "-c", command]
    task.standardOutput = pipe
    task.standardError = includeErrors ? pipe : FileHandle.nullDevice
    do { try task.run() } catch { return (error.localizedDescription, -1) }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    task.waitUntilExit()
    return (String(data: data, encoding: .utf8)?
        .trimmingCharacters(in: .whitespacesAndNewlines) ?? "", task.terminationStatus)
}

func shell(_ command: String) -> String { shellResult(command).output }

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var currentURL: URL?
    private var qrPanel: NSPanel?
    private var qrImageView: NSImageView?
    private var qrMessage: NSTextField?
    private var qrURLField: NSTextField?
    private var servicesStatusItem: NSMenuItem?
    private var keepRunningItem: NSMenuItem?

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMainMenu()

        let urlString = shell("'\(SCRIPT)' ensure")
        guard !urlString.isEmpty, let url = URL(string: urlString) else {
            let alert = NSAlert()
            alert.messageText = "Could not start DeepSeek Harness"
            alert.informativeText = "Check the log at:\n\(STATE)/run/deepshell.log"
            alert.alertStyle = .critical
            alert.runModal()
            NSApp.terminate(nil)
            return
        }
        currentURL = url

        // The search sidecar follows the app lifecycle: quit stops it
        // (stop-all), launch revives it. No-op when it isn't installed.
        DispatchQueue.global(qos: .utility).async {
            _ = shell("docker start deepshell-searxng 2>/dev/null || true")
        }

        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1440, height: 900))
        webView.navigationDelegate = self
        webView.load(URLRequest(url: url))

        window = NSWindow(
            contentRect: webView.frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "DeepShell"
        window.minSize = NSSize(width: 900, height: 600)
        window.contentView = webView
        // The window (and its web session) survives close: dock click reopens
        // it. Only Quit tears services down.
        window.isReleasedWhenClosed = false
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // Closing the window puts the app away; services keep running and agent
    // tasks continue. Cmd+Q / right-click Quit stops them (see below).
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            window?.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        // Opt-out toggle: Services → Keep Services Running After Quit.
        if FileManager.default.fileExists(atPath: KEEP_RUNNING) { return }
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/bash")
        task.arguments = ["-l", "-c", "'\(SCRIPT)' stop-all"]
        task.standardOutput = FileHandle.nullDevice
        task.standardError = FileHandle.nullDevice
        do { try task.run() } catch { return }
        // Wait, but never hang quit: 8s covers launchctl + docker stop.
        let deadline = Date().addingTimeInterval(8)
        while task.isRunning && Date() < deadline {
            RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
        }
        if task.isRunning { task.terminate() }
    }

    // Keep the Settings card in place while the user approves Tailscale in
    // their normal browser, where their provider login already lives.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.navigationType == .linkActivated,
           let url = navigationAction.request.url, url.scheme == "https",
           let host = url.host, ["tailscale.com", "login.tailscale.com"].contains(host) {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        } else {
            decisionHandler(.allow)
        }
    }

    // MARK: - Phone connect

    @objc private func connectTunnel() { phoneConnect("tunnel") }
    @objc private func disconnectAll() { phoneConnect("local") }

    private func phoneConnect(_ mode: String) {
        showQRPanel(title: "Phone Connect",
                    message: "Working… (the server restarts, give it up to a minute)",
                    url: "", image: nil)
        DispatchQueue.global(qos: .userInitiated).async {
            let result = shellResult("'\(SCRIPT)' \(mode)", includeErrors: true)
            let out = result.output
            let url = out.components(separatedBy: .whitespacesAndNewlines)
                .first {
                    guard let parts = URLComponents(string: $0), parts.scheme == "https" else { return false }
                    return parts.queryItems?.contains { $0.name == "token" && !($0.value ?? "").isEmpty } == true
                } ?? ""
            var image: NSImage? = nil
            if !url.isEmpty, mode != "local" {
                let qrPath = NSTemporaryDirectory() + "deepshell-qr-\(UUID().uuidString).png"
                _ = shell("PATH=/opt/homebrew/bin:/usr/local/bin:$PATH qrencode -o '\(qrPath)' -s 8 -m 2 '\(url)'")
                image = NSImage(contentsOfFile: qrPath)
                try? FileManager.default.removeItem(atPath: qrPath)
            }
            // The connect flow restarts the server (new token) — reload the main window.
            let fresh = shell("'\(SCRIPT)' url")
            DispatchQueue.main.async {
                if !fresh.isEmpty, let u = URL(string: fresh) {
                    self.currentURL = u
                    self.webView.load(URLRequest(url: u))
                }
                if result.status != 0 {
                    self.showQRPanel(title: "Phone Connect",
                                     message: "Could not apply the change:\n\(out.suffix(400))",
                                     url: "", image: nil)
                } else if mode == "local" {
                    self.showQRPanel(title: "Phone Connect",
                                     message: "Phone access disabled — back to localhost only.",
                                     url: "", image: nil)
                } else if url.isEmpty {
                    self.showQRPanel(title: "Phone Connect",
                                     message: "Something failed. Output:\n\(out.suffix(400))",
                                     url: "", image: nil)
                } else {
                    self.showQRPanel(
                        title: "Phone Connect",
                        message: "Scan with your phone camera. The URL is the login credential — treat it like a password.",
                        url: url, image: image)
                }
            }
        }
    }

    private func showQRPanel(title: String, message: String, url: String, image: NSImage?) {
        if qrPanel == nil {
            let panel = NSPanel(
                contentRect: NSRect(x: 0, y: 0, width: 340, height: 470),
                styleMask: [.titled, .closable], backing: .buffered, defer: false)
            panel.isFloatingPanel = true

            let iv = NSImageView(frame: NSRect(x: 40, y: 120, width: 260, height: 260))
            iv.imageScaling = .scaleProportionallyUpOrDown
            panel.contentView?.addSubview(iv)
            qrImageView = iv

            let msg = NSTextField(wrappingLabelWithString: "")
            msg.frame = NSRect(x: 20, y: 62, width: 300, height: 50)
            msg.font = NSFont.systemFont(ofSize: 11)
            panel.contentView?.addSubview(msg)
            qrMessage = msg

            let urlField = NSTextField(wrappingLabelWithString: "")
            urlField.frame = NSRect(x: 20, y: 18, width: 300, height: 40)
            urlField.font = NSFont.monospacedSystemFont(ofSize: 9, weight: .regular)
            urlField.isSelectable = true
            urlField.lineBreakMode = .byCharWrapping
            panel.contentView?.addSubview(urlField)
            qrURLField = urlField

            qrPanel = panel
        }
        qrPanel?.title = title
        qrMessage?.stringValue = message
        qrURLField?.stringValue = url
        qrImageView?.image = image
        qrImageView?.isHidden = (image == nil)
        qrPanel?.center()
        qrPanel?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // MARK: - Services menu

    @objc private func toggleKeepRunning() {
        let fm = FileManager.default
        if fm.fileExists(atPath: KEEP_RUNNING) {
            try? fm.removeItem(atPath: KEEP_RUNNING)
        } else {
            fm.createFile(atPath: KEEP_RUNNING, contents: Data())
        }
        refreshServicesMenu()
    }

    @objc private func stopServicesNow() {
        DispatchQueue.global(qos: .userInitiated).async {
            _ = shell("'\(SCRIPT)' stop-all")
            DispatchQueue.main.async { self.refreshServicesMenu() }
        }
    }

    private func refreshServicesMenu() {
        keepRunningItem?.state = FileManager.default.fileExists(atPath: KEEP_RUNNING) ? .on : .off
        let harnessUp = shell("lsof -iTCP:3080 -sTCP:LISTEN -P >/dev/null 2>&1 && echo yes || true") == "yes"
        let searchUp = shell("curl -sf -m 2 -o /dev/null http://127.0.0.1:8890/healthz && echo yes || true") == "yes"
        servicesStatusItem?.title = "Harness: \(harnessUp ? "running" : "stopped") · Search: \(searchUp ? "running" : "stopped")"
    }

    // MARK: - Menu

    private func buildMainMenu() {
        let mainMenu = NSMenu()

        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit DeepShell",
                        action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appMenuItem.submenu = appMenu

        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenuItem.submenu = editMenu

        let servicesMenuItem = NSMenuItem()
        mainMenu.addItem(servicesMenuItem)
        let servicesMenu = NSMenu(title: "Services")
        servicesMenu.delegate = self
        let statusItem = NSMenuItem(title: "…", action: nil, keyEquivalent: "")
        statusItem.isEnabled = false
        servicesMenu.addItem(statusItem)
        servicesStatusItem = statusItem
        servicesMenu.addItem(.separator())
        let keep = NSMenuItem(title: "Keep Services Running After Quit",
                              action: #selector(toggleKeepRunning), keyEquivalent: "")
        keep.target = self
        servicesMenu.addItem(keep)
        keepRunningItem = keep
        let stop = NSMenuItem(title: "Stop Services Now",
                              action: #selector(stopServicesNow), keyEquivalent: "")
        stop.target = self
        servicesMenu.addItem(stop)
        servicesMenuItem.submenu = servicesMenu

        let phoneMenuItem = NSMenuItem()
        mainMenu.addItem(phoneMenuItem)
        let phoneMenu = NSMenu(title: "Phone")
        let tun = NSMenuItem(title: "Connect Phone…", action: #selector(connectTunnel), keyEquivalent: "")
        tun.target = self
        phoneMenu.addItem(tun)
        phoneMenu.addItem(.separator())
        let off = NSMenuItem(title: "Disconnect (localhost only)", action: #selector(disconnectAll), keyEquivalent: "")
        off.target = self
        phoneMenu.addItem(off)
        phoneMenuItem.submenu = phoneMenu

        let windowMenuItem = NSMenuItem()
        mainMenu.addItem(windowMenuItem)
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowMenuItem.submenu = windowMenu

        NSApp.mainMenu = mainMenu
        NSApp.windowsMenu = windowMenu
    }
}

extension AppDelegate: NSMenuDelegate {
    func menuNeedsUpdate(_ menu: NSMenu) {
        if menu.title == "Services" { refreshServicesMenu() }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
