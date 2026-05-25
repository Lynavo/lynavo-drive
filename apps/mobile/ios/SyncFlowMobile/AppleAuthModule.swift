import Foundation
import AuthenticationServices
import React

@objc(AppleAuthModule)
class AppleAuthModule: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
  private var resolve: RCTPromiseResolveBlock?
  private var reject: RCTPromiseRejectBlock?
  
  @objc
  static func requiresMainQueueSetup() -> Bool {
    return true
  }
  
  @objc
  func constantsToExport() -> [AnyHashable : Any]! {
    let market = Bundle.main.object(forInfoDictionaryKey: "SyncFlowMarket") as? String ?? "cn"
    return ["SYNCFLOW_MARKET": market]
  }
  
  @objc
  func login(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    self.resolve = resolve
    self.reject = reject
    
    let appleIDProvider = ASAuthorizationAppleIDProvider()
    let request = appleIDProvider.createRequest()
    request.requestedScopes = [.fullName, .email]
    
    let authorizationController = ASAuthorizationController(authorizationRequests: [request])
    authorizationController.delegate = self
    authorizationController.presentationContextProvider = self
    authorizationController.performRequests()
  }
  
  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    // Return key window for displaying Apple Sign-In sheet
    if let window = UIApplication.shared.windows.first(where: { $0.isKeyWindow }) {
      return window
    }
    return UIApplication.shared.keyWindow ?? UIWindow()
  }
  
  func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
    if let appleIDCredential = authorization.credential as? ASAuthorizationAppleIDCredential {
      let identityToken = appleIDCredential.identityToken.flatMap { String(data: $0, encoding: .utf8) } ?? ""
      let authorizationCode = appleIDCredential.authorizationCode.flatMap { String(data: $0, encoding: .utf8) } ?? ""
      
      var fullNameString = ""
      if let fullName = appleIDCredential.fullName {
        var components = [String]()
        if let given = fullName.givenName { components.append(given) }
        if let family = fullName.familyName { components.append(family) }
        fullNameString = components.joined(separator: " ")
      }
      
      resolve?([
        "identityToken": identityToken,
        "authorizationCode": authorizationCode,
        "fullName": fullNameString
      ])
    } else {
      reject?("ERR_APPLE_AUTH_FAILED", "Invalid credential type", nil)
    }
  }
  
  func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
    reject?("ERR_APPLE_AUTH_FAILED", error.localizedDescription, error)
  }
}
