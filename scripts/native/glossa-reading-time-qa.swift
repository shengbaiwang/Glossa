// Test-only witness for real macOS session changes and window occlusion.
import AppKit
import Foundation

final class SessionObserver: NSObject {
    func report(_ name: String) {
        let time = Int64(Date().timeIntervalSince1970 * 1000)
        FileHandle.standardOutput.write(Data("\(time) \(name)\n".utf8))
    }

    @objc func locked(_ notification: Notification) { report("locked") }
    @objc func unlocked(_ notification: Notification) { report("unlocked") }
    @objc func sleeping(_ notification: Notification) { report("sleeping") }
    @objc func awake(_ notification: Notification) { report("awake") }
}

func observeSession() {
    let observer = SessionObserver()
    let workspace = NSWorkspace.shared.notificationCenter
    workspace.addObserver(observer, selector: #selector(SessionObserver.sleeping), name: NSWorkspace.willSleepNotification, object: nil)
    workspace.addObserver(observer, selector: #selector(SessionObserver.awake), name: NSWorkspace.didWakeNotification, object: nil)
    let distributed = DistributedNotificationCenter.default()
    distributed.addObserver(observer, selector: #selector(SessionObserver.locked), name: Notification.Name("com.apple.screenIsLocked"), object: nil, suspensionBehavior: .deliverImmediately)
    distributed.addObserver(observer, selector: #selector(SessionObserver.unlocked), name: Notification.Name("com.apple.screenIsUnlocked"), object: nil, suspensionBehavior: .deliverImmediately)
    observer.report("ready")
    RunLoop.main.run()
}

final class CoverWindow: NSWindow {
    override var canBecomeKey: Bool { true }

    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
        frameRect
    }
}

func windows() -> [[String: Any]] {
    CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
        as? [[String: Any]] ?? []
}

func bounds(_ info: [String: Any]) -> CGRect? {
    guard let dictionary = info[kCGWindowBounds as String] as? [String: Any] else { return nil }
    return CGRect(dictionaryRepresentation: dictionary as CFDictionary)
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("\(message)\n".utf8))
    exit(1)
}

func fileIdentity(_ path: String) -> [NSNumber]? {
    guard let attributes = try? FileManager.default.attributesOfItem(atPath: path),
          let device = attributes[.systemNumber] as? NSNumber,
          let inode = attributes[.systemFileNumber] as? NSNumber
    else { return nil }
    return [device, inode]
}

func cover(_ mode: String) {
    let env = ProcessInfo.processInfo.environment
    guard let readerPid = Int32(env["GLOSSA_MACOS_INPUT_PID"] ?? ""),
          let executable = env["GLOSSA_MACOS_INPUT_EXECUTABLE"],
          executable.lowercased().hasSuffix("/target/debug/glossa"),
          let reader = NSRunningApplication(processIdentifier: readerPid),
          let runningPath = reader.executableURL?.path,
          let expected = fileIdentity(executable),
          fileIdentity(runningPath) == expected
    else { fail("Expected the exact isolated WebDriver executable") }
    guard let readerInfo = windows().first(where: {
              $0[kCGWindowOwnerPID as String] as? Int32 == readerPid && $0[kCGWindowLayer as String] as? Int == 0
          }),
          let readerNumber = readerInfo[kCGWindowNumber as String] as? Int,
          let readerBounds = bounds(readerInfo),
          let primary = NSScreen.screens.first
    else { fail("Expected the isolated WebDriver reader window") }

    var frame = CGRect(x: readerBounds.minX, y: primary.frame.maxY - readerBounds.maxY,
                       width: readerBounds.width, height: readerBounds.height)
    if mode == "partial" {
        frame.size.width *= 0.35
    } else {
        // The compositor can inset the reported bounds of a borderless window.
        frame = frame.insetBy(dx: -40, dy: -40)
    }

    let app = NSApplication.shared
    app.setActivationPolicy(.regular)
    let window = CoverWindow(contentRect: frame, styleMask: .borderless, backing: .buffered, defer: false)
    window.backgroundColor = .white
    window.isOpaque = true
    window.hasShadow = false
    app.finishLaunching()
    window.setFrame(frame, display: true)
    window.makeKeyAndOrderFront(nil)
    window.orderFrontRegardless()
    app.activate(ignoringOtherApps: true)

    let deadline = Date().addingTimeInterval(5)
    while Date() < deadline {
        let ordered = windows()
        if NSWorkspace.shared.frontmostApplication?.processIdentifier == getpid(),
           let coverIndex = ordered.firstIndex(where: { $0[kCGWindowNumber as String] as? Int == window.windowNumber }),
           let readerIndex = ordered.firstIndex(where: { $0[kCGWindowNumber as String] as? Int == readerNumber }),
           coverIndex < readerIndex, let coverBounds = bounds(ordered[coverIndex]) {
            let area = coverBounds.intersection(readerBounds)
            let coverage = area.width * area.height / (readerBounds.width * readerBounds.height)
            guard mode == "full" ? coverage == 1 : (0.3...0.4).contains(coverage)
            else { fail("Unexpected reader window coverage \(coverage), reader \(readerBounds), cover \(coverBounds)") }
            let time = Int64(Date().timeIntervalSince1970 * 1000)
            print("\(time) \(coverage)")
            fflush(stdout)
            // Leave no foreground fixture behind if the runner is interrupted.
            Timer.scheduledTimer(withTimeInterval: 15, repeats: false) { _ in exit(0) }
            app.run()
            return
        }
        RunLoop.main.run(until: Date().addingTimeInterval(0.02))
    }
    fail("Cover window did not become frontmost above the reader")
}

switch CommandLine.arguments.dropFirst().first {
case "observe": observeSession()
case "partial": cover("partial")
case "full": cover("full")
default: fail("Expected observe, partial, or full")
}
