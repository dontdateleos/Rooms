# Adds the widget extension (the home-screen widget and "Watching now" on the lock screen) to
# the Xcode project, on the build machine, just before it builds. Kept out of the committed
# project so Capacitor's own tools never trip over it. Safe to run twice.
#   ruby tools/ios-widget.rb            (signing comes from ASC_WIDGET_PROFILE_NAME, if set)
require 'xcodeproj'

path = File.expand_path('../ios/App/App.xcodeproj', __dir__)
project = Xcodeproj::Project.open(path)
if project.targets.any? { |t| t.name == 'RoomsWidget' }
  puts 'widget already in the project'
  exit 0
end
app = project.targets.find { |t| t.name == 'App' } or abort('no App target')
release = app.build_configurations.find { |c| c.name == 'Release' }
marketing = release.build_settings['MARKETING_VERSION'] || '1.0'
team = ENV['TEAM'] || release.build_settings['DEVELOPMENT_TEAM'] || 'M6AXSFYX2W'

widget = project.new_target(:app_extension, 'RoomsWidget', :ios, '16.2', nil, :swift)
group = project.main_group.find_subpath('RoomsWidget', true)
group.set_source_tree('<group>')
group.set_path('RoomsWidget')
swift = Dir[File.expand_path('../ios/App/RoomsWidget/*.swift', __dir__)].sort.map { |f| group.new_reference(File.basename(f)) }
group.new_reference('Info.plist')
group.new_reference('RoomsWidget.entitlements')
# the snapshot and the Live Activity's shape are shared with the app
shared = project.files.find { |f| f.path == 'RoomsShared.swift' } or abort('RoomsShared.swift is not in the project')
widget.add_file_references(swift + [shared])
%w[WidgetKit SwiftUI ActivityKit].each { |fw| widget.add_system_framework(fw) }

profile = ENV['ASC_WIDGET_PROFILE_NAME']
widget.build_configurations.each do |c|
  s = c.build_settings
  s['PRODUCT_NAME'] = 'RoomsWidget'
  s['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.touringgroup.rooms.widget'
  s['INFOPLIST_FILE'] = 'RoomsWidget/Info.plist'
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['CODE_SIGN_ENTITLEMENTS'] = 'RoomsWidget/RoomsWidget.entitlements'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '16.2'
  s['SWIFT_VERSION'] = '5.0'
  s['TARGETED_DEVICE_FAMILY'] = '1,2'
  s['MARKETING_VERSION'] = marketing
  s['CURRENT_PROJECT_VERSION'] = release.build_settings['CURRENT_PROJECT_VERSION'] || '1'
  s['SKIP_INSTALL'] = 'YES'
  s['APPLICATION_EXTENSION_API_ONLY'] = 'YES'
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
  s['DEVELOPMENT_TEAM'] = team
  if profile && !profile.empty?
    s['CODE_SIGN_STYLE'] = 'Manual'
    s['CODE_SIGN_IDENTITY'] = 'Apple Distribution'
    s['PROVISIONING_PROFILE_SPECIFIER'] = profile
  else
    s['CODE_SIGN_STYLE'] = 'Automatic'
  end
end

# the app carries the extension inside it, and builds it first
embed = app.new_copy_files_build_phase('Embed Foundation Extensions')
embed.dst_subfolder_spec = '13'
build_file = embed.add_file_reference(widget.product_reference, true)
build_file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
app.add_dependency(widget)

project.save
puts "added the widget extension (#{marketing}, team #{team}#{profile ? ", profile #{profile}" : ''})"
