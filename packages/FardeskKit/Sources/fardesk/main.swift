import FardeskCLICore
import Foundation

exit(await FardeskCLI.execute(Array(CommandLine.arguments.dropFirst())))
