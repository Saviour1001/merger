import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

interface Options {
  excludeDirs?: string[];
  excludeFiles?: string[];
  outputPath?: string;
}

interface FileTree {
  name: string;
  type: "file" | "directory";
  children?: FileTree[];
}

function getRepoNameFromUrl(url: string): string {
  // Extract repo name from GitHub URL
  // Handles both HTTPS and SSH formats:
  // https://github.com/username/repo.git
  // git@github.com:username/repo.git
  const match = url.match(/\/([^\/]+?)(\.git)?$/);
  return match ? match[1] : "repository";
}

function generateTreeString(
  structure: FileTree,
  prefix = "",
  isLast = true
): string {
  const marker = isLast ? "└─ " : "├─ ";
  let tree = prefix + marker + structure.name + "\n";

  if (structure.children) {
    const childPrefix = prefix + (isLast ? "   " : "│  ");
    structure.children.forEach((child, index) => {
      tree += generateTreeString(
        child,
        childPrefix,
        index === structure.children!.length - 1
      );
    });
  }

  return tree;
}

async function buildFileTree(
  directory: string,
  excludeDirs: string[],
  repoName: string
): Promise<FileTree> {
  const structure: FileTree = {
    name: repoName,
    type: "directory",
    children: [],
  };

  const items = fs.readdirSync(directory);
  const sortedItems = items.sort((a, b) => {
    // Directories come first, then files
    const aIsDir = fs.statSync(path.join(directory, a)).isDirectory();
    const bIsDir = fs.statSync(path.join(directory, b)).isDirectory();
    if (aIsDir && !bIsDir) return -1;
    if (!aIsDir && bIsDir) return 1;
    return a.localeCompare(b);
  });

  for (const item of sortedItems) {
    const fullPath = path.join(directory, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      if (!excludeDirs.includes(item)) {
        const childTree = await buildFileTree(fullPath, excludeDirs, item);
        structure.children!.push(childTree);
      }
    } else {
      structure.children!.push({
        name: item,
        type: "file",
      });
    }
  }

  return structure;
}

async function mergeRepositoryFiles(
  githubUrl: string,
  options: Options = {}
): Promise<void> {
  const {
    excludeDirs = ["node_modules", ".git", "dist", "build"],
    excludeFiles = [".env", ".gitignore", "package-lock.json"],
    outputPath = "merged-output.txt",
  } = options;

  const tempDir = `temp-${Date.now()}`;
  const repoName = getRepoNameFromUrl(githubUrl);

  try {
    // Clone the repository
    console.log(`Cloning repository from ${githubUrl}...`);
    await execAsync(`git clone ${githubUrl} ${tempDir}`);

    // Generate repository structure
    const fileTree = await buildFileTree(tempDir, excludeDirs, repoName);
    const treeString =
      repoName +
      "/\n" +
      generateTreeString(fileTree, "", true)
        .split("\n")
        .slice(2) // Remove the first line since we're adding the repo name manually
        .join("\n");

    let mergedContent = `// Source: ${githubUrl}\n`;
    mergedContent += `// Merged on: ${new Date().toISOString()}\n\n`;
    mergedContent += "/*\n";
    mergedContent += treeString;
    mergedContent += "*/\n\n";

    // Rest of the file merging logic
    async function processDirectory(directory: string): Promise<void> {
      const items = fs.readdirSync(directory);

      for (const item of items) {
        const fullPath = path.join(directory, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          if (!excludeDirs.includes(item)) {
            await processDirectory(fullPath);
          }
        } else {
          const ext = path.extname(item);
          if (!excludeFiles.includes(item) && isTextFile(ext)) {
            const content = fs.readFileSync(fullPath, "utf8");
            mergedContent += `\n// File: ${fullPath.replace(
              tempDir + "/",
              repoName + "/"
            )}\n`;
            mergedContent += `${content}\n`;
          }
        }
      }
    }

    await processDirectory(tempDir);
    fs.writeFileSync(outputPath, mergedContent);
    console.log(`Successfully merged files into ${outputPath}`);
  } catch (error) {
    console.error("Error:", error);
    throw error;
  } finally {
    // Cleanup: Remove temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

function isTextFile(extension: string): boolean {
  const textExtensions = [
    ".ts",
    ".js",
    ".jsx",
    ".tsx",
    ".html",
    ".css",
    ".scss",
    ".less",
    ".json",
    ".md",
    ".txt",
    ".yml",
    ".yaml",
    ".xml",
    ".csv",
    ".py",
    ".java",
    ".rb",
    ".php",
    ".c",
    ".cpp",
    ".h",
    ".hpp",
    ".sh",
    ".rs",
  ];
  return textExtensions.includes(extension.toLowerCase());
}

// Example usage
const url = "https://github.com/Open-Sorcerer/Lunar";
if (!url) {
  console.error("Please provide a GitHub URL as an argument");
  process.exit(1);
}

mergeRepositoryFiles(url).catch((error) => {
  console.error("Failed to merge repository files:", error);
  process.exit(1);
});
