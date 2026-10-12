// NOT COMPILED OR TESTED ON A DEVICE. Obj-C++ shim over the shared C core (lva_process).
#import "LVAAudioBridge.h"
#include <vector>
#include "lumvibe/audio/lva.h"

@implementation LVAAudioBridge

+ (BOOL)hasRnnoise { return lva_has_rnnoise() != 0; }

+ (nullable NSData *)processWithParams:(NSArray<NSNumber *> *)params
                                 voice:(NSData *)voice
                             voiceRate:(int)voiceRate
                         voiceChannels:(int)voiceChannels
                                  beat:(nullable NSData *)beat
                              beatRate:(int)beatRate
                          beatChannels:(int)beatChannels
                                 error:(NSError * _Nullable * _Nullable)error {
    std::vector<float> p;
    p.reserve(params.count);
    for (NSNumber *n in params) p.push_back(n.floatValue);

    const int voiceFrames = (int)(voice.length / sizeof(float) / (NSUInteger)MAX(1, voiceChannels));
    const int beatFrames = beat ? (int)(beat.length / sizeof(float) / (NSUInteger)MAX(1, beatChannels)) : 0;

    float *out = nullptr; int frames = 0, rate = 0, ch = 0;
    const int rc = lva_process(p.data(), (int)p.size(),
                               (const float *)voice.bytes, voiceFrames, voiceRate, voiceChannels,
                               beat ? (const float *)beat.bytes : nullptr, beatFrames, beatRate, beatChannels,
                               nullptr, nullptr, &out, &frames, &rate, &ch);
    if (rc != 0 || !out) {
        if (error) {
            NSString *msg = [NSString stringWithUTF8String:lva_last_error()];
            *error = [NSError errorWithDomain:@"LumVibeAudioStudio" code:rc
                                     userInfo:@{NSLocalizedDescriptionKey: msg.length ? msg : @"Audio processing failed"}];
        }
        return nil;
    }
    // freeWhenDone:NO + manual copy would double memory; hand ownership to NSData instead.
    return [NSData dataWithBytesNoCopy:out length:(NSUInteger)frames * (NSUInteger)ch * sizeof(float) freeWhenDone:YES];
}

@end
