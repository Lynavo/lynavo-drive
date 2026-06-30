#import <React/RCTViewManager.h>
#import <UIKit/UIKit.h>

@interface VividropBlurView : UIVisualEffectView
@property (nonatomic, copy) NSString *blurStyle;
@property (nonatomic, strong) NSNumber *intensity;
@property (nonatomic, strong) UIViewPropertyAnimator *blurAnimator;
@end

@implementation VividropBlurView

- (instancetype)init
{
  self = [super initWithEffect:nil];
  if (self) {
    _blurStyle = @"systemUltraThinMaterial";
    _intensity = @(0.08);
    self.userInteractionEnabled = NO;
    self.backgroundColor = UIColor.clearColor;
    self.contentView.backgroundColor = UIColor.clearColor;
  }
  return self;
}

- (void)dealloc
{
  [self.blurAnimator stopAnimation:YES];
}

- (void)didMoveToWindow
{
  [super didMoveToWindow];
  if (self.window) {
    [self updateBlurEffect];
  }
}

- (void)setBlurStyle:(NSString *)blurStyle
{
  _blurStyle = [blurStyle copy];
  if (self.window) {
    [self updateBlurEffect];
  }
}

- (void)setIntensity:(NSNumber *)intensity
{
  _intensity = intensity;
  if (self.window) {
    [self updateBlurEffect];
  }
}

- (void)updateBlurEffect
{
  [self.blurAnimator stopAnimation:YES];
  self.blurAnimator = nil;
  self.effect = nil;
  self.alpha = 1;

  CGFloat fraction = MIN(MAX(self.intensity.doubleValue, 0), 1);
  if (fraction <= 0) {
    return;
  }

  UIBlurEffect *targetEffect = [UIBlurEffect effectWithStyle:[self effectStyleForName:self.blurStyle]];
  __weak typeof(self) weakSelf = self;
  self.blurAnimator = [[UIViewPropertyAnimator alloc]
      initWithDuration:1
                 curve:UIViewAnimationCurveLinear
            animations:^{
              weakSelf.effect = targetEffect;
            }];
  [self.blurAnimator startAnimation];
  [self.blurAnimator pauseAnimation];
  self.blurAnimator.fractionComplete = fraction;
}

- (UIBlurEffectStyle)effectStyleForName:(NSString *)styleName
{
  if ([styleName isEqualToString:@"regular"]) {
    return UIBlurEffectStyleRegular;
  }
  if ([styleName isEqualToString:@"prominent"]) {
    return UIBlurEffectStyleProminent;
  }
  if ([styleName isEqualToString:@"extraLight"]) {
    return UIBlurEffectStyleExtraLight;
  }
  if ([styleName isEqualToString:@"light"]) {
    return UIBlurEffectStyleLight;
  }
  if ([styleName isEqualToString:@"dark"]) {
    return UIBlurEffectStyleDark;
  }
  if (@available(iOS 13.0, *)) {
    if ([styleName isEqualToString:@"systemMaterial"]) {
      return UIBlurEffectStyleSystemMaterial;
    }
    if ([styleName isEqualToString:@"systemMaterialLight"]) {
      return UIBlurEffectStyleSystemMaterialLight;
    }
    if ([styleName isEqualToString:@"systemMaterialDark"]) {
      return UIBlurEffectStyleSystemMaterialDark;
    }
    if ([styleName isEqualToString:@"systemThinMaterial"]) {
      return UIBlurEffectStyleSystemThinMaterial;
    }
    if ([styleName isEqualToString:@"systemThinMaterialLight"]) {
      return UIBlurEffectStyleSystemThinMaterialLight;
    }
    if ([styleName isEqualToString:@"systemThinMaterialDark"]) {
      return UIBlurEffectStyleSystemThinMaterialDark;
    }
    if ([styleName isEqualToString:@"systemUltraThinMaterial"]) {
      return UIBlurEffectStyleSystemUltraThinMaterial;
    }
    if ([styleName isEqualToString:@"systemUltraThinMaterialDark"]) {
      return UIBlurEffectStyleSystemUltraThinMaterialDark;
    }
    return UIBlurEffectStyleSystemUltraThinMaterialLight;
  }
  return UIBlurEffectStyleExtraLight;
}

@end

@interface VividropBlurViewManager : RCTViewManager
@end

@implementation VividropBlurViewManager

RCT_EXPORT_MODULE(VividropBlurView)

- (UIView *)view
{
  return [VividropBlurView new];
}

RCT_EXPORT_VIEW_PROPERTY(blurStyle, NSString)
RCT_EXPORT_VIEW_PROPERTY(intensity, NSNumber)

@end
