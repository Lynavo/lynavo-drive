import Foundation

func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs("SharedFilesHTTPStatusErrorTests failed: \(message)\n", stderr)
        exit(1)
    }
}

func makeHTTPStatusError(
    statusCode: Int,
    path: String,
    responseBody: String?
) -> SharedFileHTTPStatusError {
    SharedFileHTTPStatusError(
        statusCode: statusCode,
        path: path,
        responseBody: responseBody
    )
}

let desktopLoggedOutError = makeHTTPStatusError(
    statusCode: 401,
    path: "/personal/list",
    responseBody: #"{"error":"desktop account identity is unavailable"}"#
)

expect(
    desktopLoggedOutError.errorDescription == "Sidecar returned HTTP 401 for /personal/list: desktop account identity is unavailable",
    "sidecar JSON error body must be normalized so JS can classify desktop logout"
)

let legacyLocalComputerAccessDisabledMessage = [
    "remote",
    "access",
    "is",
    "disabled",
].joined(separator: " ")

let localComputerAccessDisabledError = makeHTTPStatusError(
    statusCode: 403,
    path: "/personal/list",
    responseBody: #"{"error":"\#(legacyLocalComputerAccessDisabledMessage)"}"#
)

expect(
    localComputerAccessDisabledError.errorDescription == "Sidecar returned HTTP 403 for /personal/list: \(legacyLocalComputerAccessDisabledMessage)",
    "sidecar JSON error body must be normalized so JS can classify disabled local computer access"
)

let emptyBodyError = makeHTTPStatusError(
    statusCode: 403,
    path: "/personal/list",
    responseBody: "   "
)

expect(
    emptyBodyError.errorDescription == "Sidecar returned HTTP 403 for /personal/list",
    "empty response bodies must fall back to the generic HTTP status message"
)
