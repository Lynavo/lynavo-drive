# frozen_string_literal: true

require 'minitest/autorun'
require 'pathname'
require 'cocoapods'
require_relative '../cocoapods_pathname_workaround'

class CocoaPodsPathnameWorkaroundTest < Minitest::Test
  class SymlinkLikePath < Pathname
    def realdirpath(*)
      raise ArgumentError, 'pathname contains null byte'
    end
  end

  def test_group_generation_does_not_resolve_the_local_pod_base_path
    project = Pod::Project.allocate
    group = Object.new
    base_path = SymlinkLikePath.new('/workspace/node_modules/local-pod')
    source_path = base_path.join('Sources/File.swift')

    result = project.group_for_path_in_group(source_path, group, false, base_path)

    assert_same group, result
  end
end
