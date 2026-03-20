import ArgumentParser
import EventKit
import Foundation

private let store = EKEventStore()

private func requestAccess() throws {
    let semaphore = DispatchSemaphore(value: 0)
    var accessGranted = false
    var accessError: Error?

    if #available(macOS 14.0, *) {
        store.requestFullAccessToEvents { granted, error in
            accessGranted = granted
            accessError = error
            semaphore.signal()
        }
    } else {
        store.requestAccess(to: .event) { granted, error in
            accessGranted = granted
            accessError = error
            semaphore.signal()
        }
    }

    semaphore.wait()

    if let err = accessError {
        throw err
    }
    if !accessGranted {
        printError("Calendar access denied. Grant permission in System Settings > Privacy & Security > Calendars.")
        Foundation.exit(1)
    }
}

private func eventToOutput(_ event: EKEvent) -> CalendarEventOutput {
    CalendarEventOutput(
        id: event.calendarItemIdentifier ?? event.calendarItemExternalIdentifier ?? "",
        title: event.title ?? "",
        startDate: iso8601Formatter.string(from: event.startDate),
        endDate: iso8601Formatter.string(from: event.endDate),
        calendar: event.calendar?.title ?? "",
        location: event.location ?? "",
        notes: event.notes ?? "",
        isAllDay: event.isAllDay
    )
}

private func findEvent(byId id: String) -> EKEvent? {
    // Try direct lookup first (calendarItemIdentifier)
    if let item = store.calendarItem(withIdentifier: id) as? EKEvent {
        return item
    }
    // Fallback: search by external identifier
    let start = Calendar.current.date(byAdding: .year, value: -5, to: Date())!
    let end = Calendar.current.date(byAdding: .year, value: 5, to: Date())!
    let predicate = store.predicateForEvents(withStart: start, end: end, calendars: nil)
    let events = store.events(matching: predicate)
    return events.first { $0.calendarItemExternalIdentifier == id }
}

// MARK: - List

struct CalendarList: ParsableCommand {
    static let configuration = CommandConfiguration(commandName: "list")

    @Option(help: "Start date (ISO 8601)")
    var from: String

    @Option(help: "End date (ISO 8601)")
    var to: String

    func run() throws {
        try requestAccess()

        guard let startDate = iso8601Formatter.date(from: from) else {
            printError("Invalid --from date: \(from)")
            return
        }
        guard let endDate = iso8601Formatter.date(from: to) else {
            printError("Invalid --to date: \(to)")
            return
        }

        let predicate = store.predicateForEvents(withStart: startDate, end: endDate, calendars: nil)
        let events = store.events(matching: predicate)

        printJSON(EventListResult(success: true, events: events.map(eventToOutput)))
    }
}

// MARK: - Search

struct CalendarSearch: ParsableCommand {
    static let configuration = CommandConfiguration(commandName: "search")

    @Option(help: "Search query")
    var query: String

    @Option(help: "Start date (ISO 8601, default: 1 year ago)")
    var from: String?

    @Option(help: "End date (ISO 8601, default: 1 year from now)")
    var to: String?

    func run() throws {
        try requestAccess()

        let startDate = from.flatMap(iso8601Formatter.date(from:))
            ?? Calendar.current.date(byAdding: .year, value: -1, to: Date())!
        let endDate = to.flatMap(iso8601Formatter.date(from:))
            ?? Calendar.current.date(byAdding: .year, value: 1, to: Date())!

        let predicate = store.predicateForEvents(withStart: startDate, end: endDate, calendars: nil)
        let events = store.events(matching: predicate)

        let queryLower = query.lowercased()
        let filtered = events.filter { event in
            (event.title?.lowercased().contains(queryLower) ?? false) ||
            (event.location?.lowercased().contains(queryLower) ?? false) ||
            (event.notes?.lowercased().contains(queryLower) ?? false)
        }

        printJSON(EventListResult(success: true, events: filtered.map(eventToOutput)))
    }
}

// MARK: - Create

struct CalendarCreate: ParsableCommand {
    static let configuration = CommandConfiguration(commandName: "create")

    @Option(help: "Event title")
    var title: String

    @Option(help: "Start date/time (ISO 8601)")
    var start: String

    @Option(help: "End date/time (ISO 8601)")
    var end: String

    @Option(help: "Calendar name (default: default calendar)")
    var calendar: String?

    @Option(help: "Location")
    var location: String?

    @Option(help: "Notes")
    var notes: String?

    @Flag(help: "All-day event")
    var allDay: Bool = false

    func run() throws {
        try requestAccess()

        guard let startDate = iso8601Formatter.date(from: start) else {
            printError("Invalid --start date: \(start)")
            return
        }
        guard let endDate = iso8601Formatter.date(from: end) else {
            printError("Invalid --end date: \(end)")
            return
        }

        let event = EKEvent(eventStore: store)
        event.title = title
        event.startDate = startDate
        event.endDate = endDate
        event.isAllDay = allDay

        if let loc = location { event.location = loc }
        if let n = notes { event.notes = n }

        if let calName = calendar {
            let calendars = store.calendars(for: .event)
            if let cal = calendars.first(where: { $0.title == calName }) {
                event.calendar = cal
            } else {
                printError("Calendar '\(calName)' not found. Available: \(calendars.map(\.title).joined(separator: ", "))")
                return
            }
        } else {
            event.calendar = store.defaultCalendarForNewEvents
        }

        try store.save(event, span: .thisEvent)
        printJSON(EventSingleResult(success: true, event: eventToOutput(event)))
    }
}

// MARK: - Update

struct CalendarUpdate: ParsableCommand {
    static let configuration = CommandConfiguration(commandName: "update")

    @Option(help: "Event external ID")
    var id: String

    @Option(help: "New title")
    var title: String?

    @Option(help: "New start date/time (ISO 8601)")
    var start: String?

    @Option(help: "New end date/time (ISO 8601)")
    var end: String?

    @Option(help: "New calendar name")
    var calendar: String?

    @Option(help: "New location")
    var location: String?

    @Option(help: "New notes")
    var notes: String?

    func run() throws {
        try requestAccess()

        guard let event = findEvent(byId: id) else {
            printError("Event not found with ID: \(id)")
            return
        }

        if let t = title { event.title = t }
        if let s = start {
            guard let d = iso8601Formatter.date(from: s) else {
                printError("Invalid --start date: \(s)")
                return
            }
            event.startDate = d
        }
        if let e = end {
            guard let d = iso8601Formatter.date(from: e) else {
                printError("Invalid --end date: \(e)")
                return
            }
            event.endDate = d
        }
        if let loc = location { event.location = loc }
        if let n = notes { event.notes = n }
        if let calName = calendar {
            let calendars = store.calendars(for: .event)
            if let cal = calendars.first(where: { $0.title == calName }) {
                event.calendar = cal
            } else {
                printError("Calendar '\(calName)' not found")
                return
            }
        }

        try store.save(event, span: .thisEvent)
        printJSON(EventSingleResult(success: true, event: eventToOutput(event)))
    }
}

// MARK: - Delete

struct CalendarDelete: ParsableCommand {
    static let configuration = CommandConfiguration(commandName: "delete")

    @Option(help: "Event external ID")
    var id: String

    func run() throws {
        try requestAccess()

        guard let event = findEvent(byId: id) else {
            printError("Event not found with ID: \(id)")
            return
        }

        try store.remove(event, span: .thisEvent)
        printJSON(SuccessResult(success: true))
    }
}
