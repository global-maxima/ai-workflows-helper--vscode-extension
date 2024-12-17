# AI workflow helper

VS Code extension that helps prepare code for AI tools by collecting files and their dependencies. Users can select multiple files across multiple folders and copy their contents into the clipboard as a single text stream, with options to include VS Code diagnostics or related dependencies.

## Features

This extension enhances your AI workflow by providing three distinct ways to collect and share code:

**Basic Text Stream**
Copies selected files' contents into a single text stream, maintaining selection order and clear file boundaries.

**Text Stream with Diagnostics**
Includes VS Code's diagnostic information along with file contents, helping provide additional context about potential issues or warnings.

**Text Stream with Dependencies**
Collects not just the selected files, but also files they depend on based on VS Code's language services. This helps ensure AI tools have necessary context by including:
- Files containing referenced definitions
- Files containing symbols used in the selected code
- Related files within the same project, respecting project boundaries

The dependency collection respects project structure by:
- Honoring exclusions from tsconfig.json, Cargo.toml, and .gitignore
- Only including files within the project's boundaries
- Preventing upward traversal in the directory hierarchy
- Deduplicating shared dependencies

## Usage

To use the extension, right-click on one or more files in the VS Code explorer and select one of these options:

**Copy as Text Stream**
Copies just the selected files, preserving selection order.

**Copy as Text Stream with Diagnostics**
Copies selected files along with their VS Code diagnostics.

**Copy with Local Dependencies**
Copies selected files along with any files they depend on, as determined by VS Code's language services.

## Example Output

### Basic File Copying
```
--- src/file1.ts ---
content of file1
--- src/utils/file2.ts ---
content of file2
```

### Copying with Dependencies
```
--- src/components/Button.tsx ---
import { useState } from 'react';
import { styles } from '../styles/button';

export const Button = () => {
    const [pressed, setPressed] = useState(false);
    return <button className={styles.base}>Click me</button>;
};

--- src/styles/button.ts ---
export const styles = {
    base: 'rounded-md bg-blue-500 px-4 py-2'
};
```

## Known Issues
None reported.

## Contributing
Feel free to submit issues and enhancement requests on the GitHub repository.

## License
This extension is licensed under the [MIT License](LICENSE).