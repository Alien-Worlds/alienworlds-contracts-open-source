#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=clang_format_cpp_common.sh
. "${script_dir}/clang_format_cpp_common.sh"

clang_format_cmd=(clang-format)
if ! command -v clang-format >/dev/null 2>&1; then
  if command -v npx >/dev/null 2>&1; then
    clang_format_cmd=(npx --no-install clang-format)
  else
    echo "clang-format not found (install dependencies first: npm install)."
    exit 127
  fi
fi

files=()
while IFS= read -r file; do
  files+=("$file")
done < <(clang_format_cpp_list_files)
if (( ${#files[@]} == 0 )); then
  echo "No C++ files found to format."
  exit 0
fi

${clang_format_cmd[@]} -i "${files[@]}"
