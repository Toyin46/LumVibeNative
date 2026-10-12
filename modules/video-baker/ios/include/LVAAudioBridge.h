#import <Foundation/Foundation.h>

// NOT COMPILED OR TESTED ON A DEVICE (same status as the rest of ios/). Pure Objective-C
// interface — no C++ in this header — so Swift can import it safely. The C++ core is
// only touched from LVAAudioBridge.mm.
NS_ASSUME_NONNULL_BEGIN

@interface LVAAudioBridge : NSObject

+ (BOOL)hasRnnoise;

/// voice / beat: raw interleaved float32 PCM. Returns interleaved float32 STEREO @ 48 kHz,
/// or nil (with `error`) on failure.
+ (nullable NSData *)processWithParams:(NSArray<NSNumber *> *)params
                                 voice:(NSData *)voice
                             voiceRate:(int)voiceRate
                         voiceChannels:(int)voiceChannels
                                  beat:(nullable NSData *)beat
                              beatRate:(int)beatRate
                          beatChannels:(int)beatChannels
                                 error:(NSError * _Nullable * _Nullable)error;

@end

NS_ASSUME_NONNULL_END
