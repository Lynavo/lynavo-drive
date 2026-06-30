#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(AppleAuthModule, NSObject)

RCT_EXTERN_METHOD(login:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN__BLOCKING_SYNCHRONOUS_METHOD(getConstants)

@end
