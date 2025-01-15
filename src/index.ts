import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

interface Options {
  excludeDirs?: string[];
  excludeFiles?: string[];
  outputPath?: string;
  includeExtensions?: string[]; // Changed to array of extensions
}

interface FileTree {
  name: string;
  type: "file" | "directory";
  children?: FileTree[];
}

function getRepoNameFromUrl(url: string): string {
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
  repoName: string,
  includeExtensions?: string[]
): Promise<FileTree> {
  const structure: FileTree = {
    name: repoName,
    type: "directory",
    children: [],
  };

  const items = fs.readdirSync(directory);
  const sortedItems = items.sort((a, b) => {
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
        const childTree = await buildFileTree(
          fullPath,
          excludeDirs,
          item,
          includeExtensions
        );
        // Only add directories that have children (after filtering)
        if (childTree.children && childTree.children.length > 0) {
          structure.children!.push(childTree);
        }
      }
    } else {
      const ext = path.extname(item).toLowerCase();
      // Include file if no extension filter or if extension is in the include list
      if (
        !includeExtensions ||
        includeExtensions.map((e) => e.toLowerCase()).includes(ext)
      ) {
        structure.children!.push({
          name: item,
          type: "file",
        });
      }
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
    includeExtensions,
  } = options;

  const tempDir = `temp-${Date.now()}`;
  const repoName = getRepoNameFromUrl(githubUrl);

  try {
    console.log(`Cloning repository from ${githubUrl}...`);
    await execAsync(`git clone ${githubUrl} ${tempDir}`);

    const fileTree = await buildFileTree(
      tempDir,
      excludeDirs,
      repoName,
      includeExtensions
    );
    const treeString =
      repoName +
      "/\n" +
      generateTreeString(fileTree, "", true).split("\n").slice(2).join("\n");

    let mergedContent = `// Source: ${githubUrl}\n`;
    mergedContent += `// Merged on: ${new Date().toISOString()}\n\n`;
    mergedContent += "/*\n";
    mergedContent += treeString;
    mergedContent += "*/\n\n";

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
          const ext = path.extname(item).toLowerCase();
          if (
            !excludeFiles.includes(item) &&
            (!includeExtensions ||
              includeExtensions.map((e) => e.toLowerCase()).includes(ext))
          ) {
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
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

// Example usage
const url = "YOUR_URL";
if (!url) {
  console.error("Please provide a GitHub URL as an argument");
  process.exit(1);
}

// Example: Include both .rs and .ts files
mergeRepositoryFiles(url, {
  includeExtensions: [".md"], // This will include both Rust and TypeScript files
}).catch((error) => {
  console.error("Failed to merge repository files:", error);
  process.exit(1);
});
