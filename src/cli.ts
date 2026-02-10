#!/usr/bin/env node
/**
 * Saccadic AI CLI - Visual feedback system for design-build comparison.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { writeFile, readFile } from 'fs/promises';
import { ComparisonEngine } from './core/comparison-engine.js';
import { ScreenshotEngine } from './core/screenshot-engine.js';
import { DesignParser } from './core/design-parser.js';
import { PixelComparator } from './core/pixel-comparator.js';
import { TokenVersioning } from './core/token-versioning.js';
import {
  STANDARD_VIEWPORTS,
  type Viewport,
  type ComparisonResult,
  type DesignTokens,
} from './core/types.js';

const program = new Command();

// ── Viewport Resolution ──

function resolveViewport(viewportArg?: string): Viewport | undefined {
  if (!viewportArg) return undefined;

  // Check if it's a named viewport
  if (viewportArg in STANDARD_VIEWPORTS) {
    return STANDARD_VIEWPORTS[viewportArg];
  }

  // Parse WxH format
  const match = viewportArg.match(/^(\d+)x(\d+)$/);
  if (match) {
    return {
      width: parseInt(match[1], 10),
      height: parseInt(match[2], 10),
    };
  }

  throw new Error(
    `Invalid viewport: "${viewportArg}". Use a named viewport (${Object.keys(STANDARD_VIEWPORTS).join(', ')}) or WxH format (e.g., 1920x1080).`
  );
}

// ── Text Output Formatting ──

function formatTextOutput(result: ComparisonResult): string {
  const lines: string[] = [];

  lines.push(chalk.bold('\nSaccadic AI Visual Comparison Report'));
  lines.push(chalk.bold('================================\n'));

  // Overall score
  const gradeColor =
    result.overall.grade === 'A' || result.overall.grade === 'B'
      ? chalk.green
      : result.overall.grade === 'C'
        ? chalk.yellow
        : chalk.red;

  lines.push(
    `Match: ${gradeColor(`${Math.round(result.overall.matchPercentage * 100)}%`)} (Grade ${gradeColor(result.overall.grade)})`
  );
  lines.push(`${result.overall.summary}\n`);

  // Issues
  const fails = result.feedback.filter((f) => f.severity === 'fail');
  const warns = result.feedback.filter((f) => f.severity === 'warn');

  if (fails.length === 0 && warns.length === 0) {
    lines.push(chalk.green('No issues found!'));
  } else {
    lines.push(`Issues (${fails.length + warns.length}):\n`);

    // Fails first
    fails.forEach((item) => {
      const prefix = chalk.red('[FAIL]');
      const element = item.element ? ` on ${chalk.cyan(item.element)}` : '';
      lines.push(`${prefix} ${item.message}${element}`);
    });

    // Then warnings
    warns.forEach((item) => {
      const prefix = chalk.yellow('[WARN]');
      const element = item.element ? ` on ${chalk.cyan(item.element)}` : '';
      lines.push(`${prefix} ${item.message}${element}`);
    });
  }

  // Suggested fixes
  const fixes = result.feedback.filter((f) => f.fix);
  if (fixes.length > 0) {
    lines.push('\n' + chalk.bold('Suggested fixes:'));
    fixes.forEach((item) => {
      lines.push(`- ${item.fix}`);
    });
  }

  // DOM stats
  if (result.domDiff.missing.length > 0 || result.domDiff.extra.length > 0) {
    lines.push('');
    if (result.domDiff.missing.length > 0) {
      lines.push(chalk.yellow(`Missing elements: ${result.domDiff.missing.join(', ')}`));
    }
    if (result.domDiff.extra.length > 0) {
      lines.push(chalk.yellow(`Extra elements: ${result.domDiff.extra.join(', ')}`));
    }
  }

  // Pixel diff stats
  lines.push('');
  lines.push(
    `Pixel diff: ${result.pixelDiff.diffPercentage.toFixed(2)}% (${result.pixelDiff.diffPixels.toLocaleString()} / ${result.pixelDiff.totalPixels.toLocaleString()} pixels)`
  );

  return lines.join('\n') + '\n';
}

// ── Commands ──

program
  .name('saccadic-ai')
  .description('Saccadic AI visual feedback system for design-build comparison')
  .version('0.1.0');

program
  .command('compare')
  .description('Compare design against built implementation')
  .requiredOption('--design <figma-url-or-file>', 'Figma URL, design token file, or .pen file')
  .requiredOption('--build <url>', 'URL of the built implementation')
  .option('--viewport <name-or-WxH>', 'Viewport size (named or WxH format)', 'desktop')
  .option('--selector <css>', 'CSS selector to target specific element')
  .option('--threshold <number>', 'Match threshold (0-1)', '0.9')
  .option('--format <format>', 'Output format (json|text)', 'text')
  .option('--pencil-frame <name>', 'Frame name/id to extract from .pen file')
  .option('--pencil-theme <mode>', 'Theme mode for .pen file (e.g., "Light", "Dark")')
  .action(async (options) => {
    try {
      const viewport = resolveViewport(options.viewport);
      const threshold = parseFloat(options.threshold);

      if (isNaN(threshold) || threshold < 0 || threshold > 1) {
        throw new Error('Threshold must be a number between 0 and 1');
      }

      const engine = new ComparisonEngine();
      await engine.init();

      // Determine design source type
      let designSource: Record<string, string>;
      if (options.design.endsWith('.pen')) {
        designSource = { pencilFile: options.design };
        if (options.pencilFrame) designSource.pencilFrame = options.pencilFrame;
        if (options.pencilTheme) designSource.pencilTheme = options.pencilTheme;
      } else if (options.design.startsWith('http')) {
        const fileKeyMatch = options.design.match(/file\/([a-zA-Z0-9]+)/);
        if (!fileKeyMatch) {
          throw new Error('Invalid Figma URL format. Expected: https://figma.com/file/<key>/...');
        }
        designSource = { figmaFileKey: fileKeyMatch[1] };
      } else {
        designSource = { tokenFile: options.design };
      }

      const result = await engine.compare({
        designSource,
        buildUrl: options.build,
        viewport,
        selector: options.selector,
        threshold,
      });

      if (options.format === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(formatTextOutput(result));
      }

      await engine.close();

      // Exit code based on threshold (matchPercentage is 0-1 fraction)
      process.exit(result.overall.matchPercentage >= threshold ? 0 : 1);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('capture')
  .description('Capture a screenshot of a URL')
  .requiredOption('--url <url>', 'URL to capture')
  .option('--viewport <name-or-WxH>', 'Viewport size (named or WxH format)', 'desktop')
  .option('--selector <css>', 'CSS selector to target specific element')
  .option('--output <file>', 'Output file path (default: base64 to stdout)')
  .action(async (options) => {
    try {
      const viewport = resolveViewport(options.viewport);
      const engine = new ScreenshotEngine();

      const result = await engine.capture({
        url: options.url,
        viewport,
        selector: options.selector,
      });

      if (options.output) {
        await writeFile(options.output, result.image);
        console.log(chalk.green(`Screenshot saved to ${options.output}`));
      } else {
        // Output base64
        console.log(result.image.toString('base64'));
      }

      await engine.close();
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('tokens')
  .description('Extract design tokens from Figma or token file')
  .requiredOption('--source <figma-url-or-file>', 'Figma URL or design token file')
  .option('--format <format>', 'Output format (json|text)', 'json')
  .action(async (options) => {
    try {
      const parser = new DesignParser();
      let tokens: DesignTokens;

      if (options.source.startsWith('http')) {
        // Extract from Figma URL
        const fileKeyMatch = options.source.match(/file\/([a-zA-Z0-9]+)/);
        if (!fileKeyMatch) {
          throw new Error('Invalid Figma URL format');
        }
        tokens = await parser.extractTokensFromFigma(fileKeyMatch[1]);
      } else {
        // Load from token file
        const fileContent = await readFile(options.source, 'utf-8');
        tokens = JSON.parse(fileContent) as DesignTokens;
      }

      if (options.format === 'json') {
        console.log(JSON.stringify(tokens, null, 2));
      } else {
        // Text format
        console.log(chalk.bold('\nDesign Tokens'));
        console.log(chalk.bold('=============\n'));

        if (Object.keys(tokens.colors).length > 0) {
          console.log(chalk.bold('Colors:'));
          Object.entries(tokens.colors).forEach(([name, value]) => {
            console.log(`  ${name}: ${value}`);
          });
          console.log('');
        }

        if (Object.keys(tokens.spacing).length > 0) {
          console.log(chalk.bold('Spacing:'));
          Object.entries(tokens.spacing).forEach(([name, value]) => {
            console.log(`  ${name}: ${value}`);
          });
          console.log('');
        }

        if (Object.keys(tokens.typography).length > 0) {
          console.log(chalk.bold('Typography:'));
          Object.entries(tokens.typography).forEach(([name, value]) => {
            console.log(`  ${name}:`);
            console.log(`    fontFamily: ${value.fontFamily}`);
            console.log(`    fontSize: ${value.fontSize}`);
            console.log(`    fontWeight: ${value.fontWeight}`);
            console.log(`    lineHeight: ${value.lineHeight}`);
            if (value.letterSpacing) {
              console.log(`    letterSpacing: ${value.letterSpacing}`);
            }
          });
          console.log('');
        }

        if (Object.keys(tokens.shadows).length > 0) {
          console.log(chalk.bold('Shadows:'));
          Object.entries(tokens.shadows).forEach(([name, value]) => {
            console.log(`  ${name}: ${value}`);
          });
          console.log('');
        }

        if (Object.keys(tokens.borders).length > 0) {
          console.log(chalk.bold('Borders:'));
          Object.entries(tokens.borders).forEach(([name, value]) => {
            console.log(`  ${name}: ${value}`);
          });
          console.log('');
        }

        if (Object.keys(tokens.radii).length > 0) {
          console.log(chalk.bold('Border Radii:'));
          Object.entries(tokens.radii).forEach(([name, value]) => {
            console.log(`  ${name}: ${value}`);
          });
          console.log('');
        }
      }

      process.exit(0);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('diff')
  .description('Pixel diff two local images')
  .requiredOption('--design <image-path>', 'Path to design image')
  .requiredOption('--build <image-path>', 'Path to build image')
  .option('--output <file>', 'Output file path for diff overlay')
  .action(async (options) => {
    try {
      const comparator = new PixelComparator();

      // Read images
      const designImage = await readFile(options.design);
      const buildImage = await readFile(options.build);

      const result = await comparator.compare(designImage, buildImage);

      console.log(chalk.bold('\nPixel Difference Report'));
      console.log(chalk.bold('=======================\n'));
      console.log(
        `Diff: ${result.diffPercentage.toFixed(2)}% (${result.diffPixels.toLocaleString()} / ${result.totalPixels.toLocaleString()} pixels)`
      );

      if (result.diffImage && options.output) {
        await writeFile(options.output, result.diffImage);
        console.log(chalk.green(`\nDiff overlay saved to ${options.output}`));
      }

      // Exit code 0 if images are identical, 1 otherwise
      process.exit(result.diffPercentage === 0 ? 0 : 1);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('tokens-diff')
  .description('Compare two design token files and report changes')
  .requiredOption('--old <file>', 'Path to old design token file')
  .requiredOption('--new <file>', 'Path to new design token file')
  .option('--format <format>', 'Output format (json|text)', 'text')
  .action(async (options) => {
    try {
      const oldContent = await readFile(options.old, 'utf-8');
      const newContent = await readFile(options.new, 'utf-8');

      const oldTokens = JSON.parse(oldContent) as DesignTokens;
      const newTokens = JSON.parse(newContent) as DesignTokens;

      const versioning = new TokenVersioning();
      const diff = versioning.diff(oldTokens, newTokens);

      if (options.format === 'json') {
        console.log(JSON.stringify(diff, null, 2));
      } else {
        console.log(chalk.bold('\nDesign Token Diff'));
        console.log(chalk.bold('=================\n'));

        if (diff.breaking) {
          console.log(chalk.red.bold('BREAKING CHANGES DETECTED\n'));
        } else {
          console.log(chalk.green('No breaking changes.\n'));
        }

        if (diff.added.length > 0) {
          console.log(chalk.green(`Added (${diff.added.length}):`));
          diff.added.forEach((c) => {
            console.log(`  + ${c.path}: ${c.newValue}`);
          });
          console.log('');
        }

        if (diff.removed.length > 0) {
          console.log(chalk.red(`Removed (${diff.removed.length}):`));
          diff.removed.forEach((c) => {
            console.log(`  - ${c.path}: ${c.oldValue}`);
          });
          console.log('');
        }

        if (diff.changed.length > 0) {
          console.log(chalk.yellow(`Changed (${diff.changed.length}):`));
          diff.changed.forEach((c) => {
            const marker = c.isBreaking ? chalk.red('[BREAKING]') : '';
            console.log(`  ~ ${c.path}: ${c.oldValue} → ${c.newValue} ${marker}`);
          });
          console.log('');
        }

        if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
          console.log(chalk.green('No differences found.'));
        }
      }

      // Exit code: 1 if breaking changes, 0 otherwise
      process.exit(diff.breaking ? 1 : 0);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program.parse();
