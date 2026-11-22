// One plain-HTTP GET with a default URLSession, for scripts/check-ats.sh. Prints "status <code>" when the server
// answered or "error <domain>#<code>" when the request failed (ATS refuses plain HTTP with NSURLErrorDomain#-1022
// before any connection is made). Run it inside an .app bundle: ATS is not enforced for a bare command-line tool.
import Foundation

guard CommandLine.arguments.count == 2, let url = URL(string: CommandLine.arguments[1]) else {
    FileHandle.standardError.write(Data("usage: ats-probe <http url>\n".utf8))
    exit(2)
}
var request = URLRequest(url: url, timeoutInterval: 3)
request.httpMethod = "GET"
let done = DispatchSemaphore(value: 0)
URLSession(configuration: .ephemeral).dataTask(with: request) { _, response, error in
    if let error = error as NSError? {
        print("error \(error.domain)#\(error.code)")
    } else if let http = response as? HTTPURLResponse {
        print("status \(http.statusCode)")
    }
    done.signal()
}.resume()
done.wait()
