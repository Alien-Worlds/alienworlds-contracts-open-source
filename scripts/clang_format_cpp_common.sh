#!/usr/bin/env bash
set -euo pipefail

clang_format_cpp_list_files() {
  git ls-files \
    '**/*.cpp' \
    '**/*.cc' \
    '**/*.cxx' \
    '**/*.hpp' \
    '**/*.hh' \
    '**/*.hxx' \
    ':(exclude)contracts/common/contracts-common/**' \
    ':(exclude)contracts/atomicassets-contracts/**' \
    ':(exclude)contracts/eosdac-contracts/**'
}

