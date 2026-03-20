import ArgumentParser
import EventKit
import Foundation

@main
struct CCBuddyHelper: ParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "ccbuddy-helper",
        abstract: "CCBuddy native macOS helper",
        subcommands: [CalendarCommand.self]
    )
}

struct CalendarCommand: ParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "calendar",
        abstract: "Calendar operations",
        subcommands: [
            CalendarList.self,
            CalendarSearch.self,
            CalendarCreate.self,
            CalendarUpdate.self,
            CalendarDelete.self,
        ]
    )
}
