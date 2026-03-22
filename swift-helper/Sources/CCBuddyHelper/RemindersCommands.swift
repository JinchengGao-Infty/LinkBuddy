import ArgumentParser
import Foundation

// MARK: - AppleScript helper (shared with CalendarCommands via same module)

private func runAppleScript(_ script: String, app: String = "Reminders") throws -> String {
    // Ensure the target app is running (needed for launchd/SSH contexts)
    let openProc = Process()
    openProc.executableURL = URL(fileURLWithPath: "/usr/bin/open")
    openProc.arguments = ["-gja", app]
    try? openProc.run()
    openProc.waitUntilExit()
    Thread.sleep(forTimeInterval: 0.5)

    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    proc.arguments = ["-e", script]
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

private func escapeAS(_ s: String) -> String {
    return s.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
}

// MARK: - List

struct RemindersList: ParsableCommand {
    static let configuration = CommandConfiguration(commandName: "list")

    @Option(help: "Reminder list name (default: all lists)")
    var list: String?

    @Flag(help: "Include completed reminders")
    var showCompleted: Bool = false

    func run() throws {
        let listFilter = list.map { "of list \"\(escapeAS($0))\"" } ?? ""
        let completedFilter = showCompleted ? "" : "whose completed is false"

        let script = """
        set output to ""
        tell application "Reminders"
            set allReminders to every reminder \(listFilter) \(completedFilter)
            repeat with rem in allReminders
                set remId to id of rem
                set remTitle to name of rem
                set remCompleted to completed of rem
                set remDue to ""
                try
                    set d to due date of rem
                    set remDue to (d as «class isot» as string)
                end try
                set remList to name of container of rem
                set remNotes to ""
                try
                    set remNotes to body of rem
                end try
                set remPriority to priority of rem
                set output to output & remId & "\\t" & remTitle & "\\t" & remCompleted & "\\t" & remDue & "\\t" & remList & "\\t" & remNotes & "\\t" & remPriority & "\\n"
            end repeat
        end tell
        return output
        """

        let result = try runAppleScript(script)
        let reminders = parseRemindersOutput(result)
        printJSON(ReminderListResult(success: true, reminders: reminders))
    }
}

// MARK: - Create

struct RemindersCreate: ParsableCommand {
    static let configuration = CommandConfiguration(commandName: "create")

    @Option(help: "Reminder title")
    var title: String

    @Option(help: "Due date/time (ISO 8601)")
    var due: String?

    @Option(help: "Reminder list name (default: default list)")
    var list: String?

    @Option(help: "Notes")
    var notes: String?

    @Option(help: "Priority (0=none, 1=high, 5=medium, 9=low)")
    var priority: Int?

    func run() throws {
        let titleEsc = escapeAS(title)
        let listTarget = list.map { "list \"\(escapeAS($0))\"" } ?? "default list"

        var props = "name:\"\(titleEsc)\""
        if let p = priority { props += ", priority:\(p)" }

        var extraLines: [String] = []
        if let dueStr = due, let dueDate = parseISO8601Date(dueStr) {
            let df = DateFormatter()
            df.locale = Locale.current
            df.dateStyle = .long
            df.timeStyle = .long
            extraLines.append("set due date of newRem to date \"\(df.string(from: dueDate))\"")
        }
        if let n = notes {
            extraLines.append("set body of newRem to \"\(escapeAS(n))\"")
        }

        let script = """
        tell application "Reminders"
            tell \(listTarget)
                set newRem to make new reminder with properties {\(props)}
                \(extraLines.joined(separator: "\n                "))
                set remId to id of newRem
                set remTitle to name of newRem
                set remCompleted to completed of newRem
                set remDue to ""
                try
                    set d to due date of newRem
                    set remDue to (d as «class isot» as string)
                end try
                set remList to name of container of newRem
                set remNotes to ""
                try
                    set remNotes to body of newRem
                end try
                set remPriority to priority of newRem
                return remId & "\\t" & remTitle & "\\t" & remCompleted & "\\t" & remDue & "\\t" & remList & "\\t" & remNotes & "\\t" & remPriority
            end tell
        end tell
        """

        let result = try runAppleScript(script)
        let reminders = parseRemindersOutput(result)
        if let reminder = reminders.first {
            printJSON(ReminderSingleResult(success: true, reminder: reminder))
        } else {
            printError("Failed to create reminder")
        }
    }
}

// MARK: - Complete

struct RemindersComplete: ParsableCommand {
    static let configuration = CommandConfiguration(commandName: "complete")

    @Option(help: "Reminder ID")
    var id: String

    func run() throws {
        let idEsc = escapeAS(id)
        let script = """
        tell application "Reminders"
            set targetRem to missing value
            repeat with lst in lists
                try
                    set rems to (every reminder of lst whose id is "\(idEsc)")
                    if (count of rems) > 0 then
                        set targetRem to item 1 of rems
                        exit repeat
                    end if
                end try
            end repeat
            if targetRem is missing value then error "Reminder not found with ID: \(idEsc)"
            set completed of targetRem to true
            set remId to id of targetRem
            set remTitle to name of targetRem
            set remCompleted to completed of targetRem
            set remDue to ""
            try
                set d to due date of targetRem
                set remDue to (d as «class isot» as string)
            end try
            set remList to name of container of targetRem
            set remNotes to ""
            try
                set remNotes to body of targetRem
            end try
            set remPriority to priority of targetRem
            return remId & "\\t" & remTitle & "\\t" & remCompleted & "\\t" & remDue & "\\t" & remList & "\\t" & remNotes & "\\t" & remPriority
        end tell
        """

        let result = try runAppleScript(script)
        let reminders = parseRemindersOutput(result)
        if let reminder = reminders.first {
            printJSON(ReminderSingleResult(success: true, reminder: reminder))
        } else {
            printError("Failed to complete reminder")
        }
    }
}

// MARK: - Delete

struct RemindersDelete: ParsableCommand {
    static let configuration = CommandConfiguration(commandName: "delete")

    @Option(help: "Reminder ID")
    var id: String

    func run() throws {
        let idEsc = escapeAS(id)
        let script = """
        tell application "Reminders"
            repeat with lst in lists
                try
                    set rems to (every reminder of lst whose id is "\(idEsc)")
                    if (count of rems) > 0 then
                        delete item 1 of rems
                        return "ok"
                    end if
                end try
            end repeat
            error "Reminder not found with ID: \(idEsc)"
        end tell
        """
        _ = try runAppleScript(script)
        printJSON(SuccessResult(success: true))
    }
}

// MARK: - Parser

private func parseRemindersOutput(_ raw: String) -> [ReminderOutput] {
    guard !raw.isEmpty else { return [] }
    return raw.components(separatedBy: "\n").compactMap { line in
        let line = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !line.isEmpty else { return nil }
        let parts = line.components(separatedBy: "\t")
        guard parts.count >= 7 else { return nil }
        return ReminderOutput(
            id: parts[0],
            title: parts[1],
            isCompleted: parts[2] == "true",
            dueDate: parts[3].isEmpty ? nil : parts[3],
            list: parts[4],
            notes: parts[5],
            priority: Int(parts[6]) ?? 0
        )
    }
}
