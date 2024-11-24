# AI workflow helper

Allows users to select multiple files across multiple folders, right-click on them, and copy their contents into the clipboard as one text stream, optionally including vs code diagnostics output for those files. Each file's content will be preceded by its filename, and the files and folders will be placed in the text stream in the order they were selected.

## Features

### File Copying
- Right-click on files to copy their contents as a text stream
- Copy multiple files and folders in the order they were selected
- File contents are formatted with clear separators and filenames
- Diagnostics output can be included
- Works across multiple folders

## Usage

### Copying Files and Folders
1. Select one or more folders in the VS Code explorer
2. Right-click and select "Copy Files as Text Stream" or "Copy Files and Files in Folders as Text Stream"
3. All files within the selected folders will be copied to your clipboard

### Include Diagnostics
1. Select one or more folders in the VS Code explorer
2. Right-click and select "Copy Files, including Diagnostics" or "Copy Files and Files in Folders, including Diagnostics"
3. All files within the selected folders and their vs code diagnostics will be copied to your clipboard

## Example Output

### File Copying
```
--- src/file1.ts ---
content of file1

--- src/utils/file2.ts ---
content of file2

--- src/components/file3.ts ---
content of file3
```

### File Inclusion
```typescript
// Original file:
const config = {
  // @include ./config/default.json
};

// After inclusion:
const config = {
  "port": 3000,
  "debug": true,
  "database": {
    "host": "localhost",
    "port": 5432
  }
};
```

## Requirements
- VS Code version 1.94.0 or higher

## Extension Settings
This extension contributes the following settings:
* `aiWorkflowHelper.includePattern`: Configure the pattern used for file inclusion
* `aiWorkflowHelper.autoScanIncludes`: Enable/disable automatic scanning of files for includes

## Known Issues
None reported.

## Contributing
Feel free to submit issues and enhancement requests on the GitHub repository.

## License
This extension is licensed under the [MIT License](LICENSE).