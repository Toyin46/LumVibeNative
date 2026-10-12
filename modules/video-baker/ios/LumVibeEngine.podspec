require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', '..', 'package.json'))) rescue { 'version' => '1.0.0' }

Pod::Spec.new do |s|
  s.name           = 'LumVibeEngine'
  s.version        = package['version'] || '1.0.0'
  s.summary        = 'LumVibe AR effects engine — iOS native module'
  s.homepage       = 'https://lumvibe.app'
  s.platforms      = { ios: '15.0' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # EAS Build's cloud macOS machine runs `pod install` automatically during
  # the iOS build step and will fetch this from CocoaPods' trunk — nothing
  # to download or install yourself, same as how your Android build.gradle
  # already pulls com.google.mediapipe:tasks-vision from Maven without you
  # manually downloading anything.
  s.dependency 'MediaPipeTasksVision'

  s.source_files = [
    'include/**/*.{h}',
    'src/**/*.{mm,cpp}',
    'swift/**/*.swift',
    '../include/lumvibe/**/*.h',
    '../src/EffectEngine.cpp',
  ]

  s.pod_target_xcconfig = {
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'HEADER_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/include" "$(PODS_TARGET_SRCROOT)/../include"',
  }

  s.frameworks = ['Metal', 'QuartzCore', 'CoreVideo', 'AVFoundation']
end
