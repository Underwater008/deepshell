import Cocoa
import WebKit

// DSH — a minimal native window for the official DeepSeek Harness web UI.
// It starts the local service if needed (via dsh-web.sh ensure) and hosts
// the UI in a WKWebView. No Electron, no dependencies.

let STATE = NSHomeDirectory() + "/Library/Application Support/dsh-web-launcher"
let SCRIPT = STATE + "/dsh-web.sh"

func shell(_ command: String) -> String {
    let task = Process()
    let pipe = Pipe()
    task.executableURL = URL(fileURLWithPath: "/bin/bash")
    task.arguments = ["-l", "-c", command]
    task.standardOutput = pipe
    task.standardError = FileHandle.nullDevice
    do { try task.run() } catch { return "" }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    task.waitUntilExit()
    return String(data: data, encoding: .utf8)?
        .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var qrPanel: NSPanel?
    private var qrImageView: NSImageView?
    private var qrMessage: NSTextField?
    private var qrURLField: NSTextField?

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMainMenu()

        let urlString = shell("'\(SCRIPT)' ensure")
        guard !urlString.isEmpty, let url = URL(string: urlString) else {
            let alert = NSAlert()
            alert.messageText = "Could not start DeepSeek Harness"
            alert.informativeText = "Check the log at:\n\(STATE)/run/dsh-web.log"
            alert.alertStyle = .critical
            alert.runModal()
            NSApp.terminate(nil)
            return
        }

        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1440, height: 900))
        webView.load(URLRequest(url: url))

        window = NSWindow(
            contentRect: webView.frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "DeepSeek Harness"
        window.minSize = NSSize(width: 900, height: 600)
        window.contentView = webView
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    // MARK: - Phone connect

    @objc private func connectLAN()    { phoneConnect("lan") }
    @objc private func connectTunnel() { phoneConnect("tunnel") }
    @objc private func disconnectAll() { phoneConnect("local") }

    private func phoneConnect(_ mode: String) {
        showQRPanel(title: "Phone Connect",
                    message: "Working… (the server restarts, give it up to a minute)",
                    url: "", image: nil)
        DispatchQueue.global(qos: .userInitiated).async {
            let out = shell("'\(SCRIPT)' \(mode)")
            let url = out.components(separatedBy: .whitespacesAndNewlines)
                .first { $0.hasPrefix("http://") || $0.hasPrefix("https://") } ?? ""
            var image: NSImage? = nil
            if !url.isEmpty, mode != "local" {
                _ = shell("/opt/homebrew/bin/qrencode -o /tmp/dsh-qr.png -s 8 -m 2 '\(url)'")
                image = NSImage(contentsOfFile: "/tmp/dsh-qr.png")
            }
            // The connect flow restarts the server (new token) — reload the main window.
            let fresh = shell("'\(SCRIPT)' url")
            DispatchQueue.main.async {
                if !fresh.isEmpty, let u = URL(string: fresh) {
                    self.webView.load(URLRequest(url: u))
                }
                if mode == "local" {
                    self.showQRPanel(title: "Phone Connect",
                                     message: "Phone access disabled — back to localhost only.",
                                     url: "", image: nil)
                } else if url.isEmpty {
                    self.showQRPanel(title: "Phone Connect",
                                     message: "Something failed. Output:\n\(out.suffix(400))",
                                     url: "", image: nil)
                } else {
                    self.showQRPanel(
                        title: mode == "lan" ? "Wi-Fi Connect" : "Internet Connect",
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

    // MARK: - Menu

    private func buildMainMenu() {
        let mainMenu = NSMenu()

        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit DeepSeek Harness",
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

        let phoneMenuItem = NSMenuItem()
        mainMenu.addItem(phoneMenuItem)
        let phoneMenu = NSMenu(title: "Phone")
        let lan = NSMenuItem(title: "Wi-Fi Connect (LAN)…", action: #selector(connectLAN), keyEquivalent: "")
        lan.target = self
        phoneMenu.addItem(lan)
        let tun = NSMenuItem(title: "Internet Connect (Tunnel)…", action: #selector(connectTunnel), keyEquivalent: "")
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

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
