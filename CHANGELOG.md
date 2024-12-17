# Change Log

All notable changes to the "ai-workflows-helper" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]
- Initial release

## [0.0.3] - 2024-10-12
### Added
- Ability to copy content of folders

## [0.0.5] - 2024-10-16
### Changed
- Place file and folder names as relative paths instead of file/folder names

## [0.0.7] - 2024-11-15
### Added
- File text content inclusion functionality with automatic content synchronization

## [0.0.9] - 2024-11-24
### Removed
- File text content inclusion functionality with automatic content synchronization. Will be available as part of a separate extention `smart-portals`

### Added
- Including VSCode diagnostics output of selected files, as part of copied stream

## [0.0.10] - 2024-11-24
### Fixed
- Diagnostics inclusion when triggered from menu item on context menu of single folder

## [0.0.11] - 2024-12-11
### Fixed
- Copying when both files and folders are selected, and context menu is opened from a file. 

## [0.0.12] - 2024-12-12
### Fixed
- Simplified menu items into 2: Copy and Copy with Diagnostics. 
- Made notifications disappear after 3 seconds

## [0.0.13] - 2024-12-17
### Added
- Copy files with their local dependencies, relying on VS Code's language services view of dependencies