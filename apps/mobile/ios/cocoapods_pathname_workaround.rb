# frozen_string_literal: true

require 'pathname'

module LynavoDrive
  module CocoaPodsPathnameWorkaround
    class NonResolvingPathname < Pathname
      def realdirpath(*)
        cleanpath
      end
    end

    def group_for_path_in_group(absolute_pathname, group, reflect_file_system_structure, base_path = nil)
      stable_base_path = base_path && NonResolvingPathname.new(base_path.to_s)
      super(absolute_pathname, group, reflect_file_system_structure, stable_base_path)
    end
  end
end

# CocoaPods can intermittently reject pnpm symlink paths while generating the
# Pods project. Preserve its grouping logic while avoiding filesystem resolution.
Pod::Project.prepend(LynavoDrive::CocoaPodsPathnameWorkaround)
