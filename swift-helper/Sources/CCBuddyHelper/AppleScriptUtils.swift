import Foundation

/// Ensure a macOS app is running (needed for launchd/SSH contexts where apps aren't launched by default)
func ensureAppRunning(_ appName: String) {
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/bin/open")
    proc.arguments = ["-gja", appName]
    try? proc.run()
    proc.waitUntilExit()
    Thread.sleep(forTimeInterval: 0.5)
}

/// Run an AppleScript string via /usr/bin/osascript, ensuring the target app is running first.
/// Automatically prepends the makeDate() helper if the script uses it.
func runAppleScript(_ script: String, app: String) throws -> String {
    ensureAppRunning(app)
    let fullScript = script.contains("my makeDate(") ? appleScriptDateHelper + "\n" + script : script
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    proc.arguments = ["-e", fullScript]
    let pipe = Pipe()
    proc.standardOutput = pipe
    proc.standardError = pipe
    try proc.run()
    proc.waitUntilExit()
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    let output = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if proc.terminationStatus != 0 {
        throw NSError(domain: "AppleScript", code: Int(proc.terminationStatus),
                      userInfo: [NSLocalizedDescriptionKey: output])
    }
    return output
}

/// Escape a string for safe embedding in AppleScript string literals
func escapeForAppleScript(_ s: String) -> String {
    return s.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "\r", with: " ")
}

/// Build an AppleScript expression that constructs a date from components.
/// This avoids locale-dependent `date "..."` parsing entirely.
/// Returns an expression like: `current date's (setYear(2026, 3, 23, 9, 0, 0))`
/// which is wrapped in a helper function injected into the script.
func formatDateForAppleScript(_ date: Date) -> String {
    let cal = Calendar(identifier: .gregorian)
    let c = cal.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
    return "my makeDate(\(c.year!), \(c.month!), \(c.day!), \(c.hour!), \(c.minute!), \(c.second!))"
}

/// AppleScript helper function that must be included at the top of any script using formatDateForAppleScript.
/// Constructs a date object from numeric components, avoiding locale-dependent string parsing.
let appleScriptDateHelper = """
on makeDate(yr, mn, dy, hr, mi, sc)
    set d to current date
    set year of d to yr
    set month of d to mn
    set day of d to dy
    set hours of d to hr
    set minutes of d to mi
    set seconds of d to sc
    return d
end makeDate
"""
