import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  ensureBasiliskDocs,
  getBasiliskDoc,
  type BasiliskDocEntry,
  // Internal functions exported for testing
  parseDocsFromFile,
  parseGlobalsFromFile,
  cleanDocComment,
  formatDoc,
  findSignatureAfter,
  splitTopLevelCommas,
  parseDeclaration,
  isModifierLine
} from '../src/basiliskDocs';

describe('basiliskDocs', () => {
  describe('cleanDocComment', () => {
    test('strips /** */ markers and leading asterisks', () => {
      const lines = [
        '  /** This is a comment',
        '   * with multiple lines',
        '   * and more text',
        '   */'
      ];
      const result = cleanDocComment(lines);
      expect(result).toBe('This is a comment\nwith multiple lines\nand more text');
    });

    test('handles /*! */ doxygen-style comments', () => {
      const lines = ['/*! Brief description', ' * Details', ' */'];
      const result = cleanDocComment(lines);
      expect(result).toBe('Brief description\nDetails');
    });

    test('handles single-line doc comments', () => {
      const lines = ['/** Brief description */'];
      const result = cleanDocComment(lines);
      expect(result).toBe('Brief description');
    });

    test('strips optional space after asterisk', () => {
      const lines = ['/**', ' *No space', ' * With space', ' */'];
      const result = cleanDocComment(lines);
      expect(result).toBe('No space\nWith space');
    });
  });

  describe('formatDoc', () => {
    test('returns bold signature when no doc text', () => {
      const result = formatDoc('foo(int x)', '', 'foo');
      expect(result).toBe('**foo(int x)**');
    });

    test('combines signature with doc text', () => {
      const result = formatDoc('bar()', 'This function does something', 'bar');
      expect(result).toBe('**bar()**\n\nThis function does something');
    });

    test('transforms heading with name to description', () => {
      const docText = '# foo: performs an operation\nMore details here';
      const result = formatDoc('foo()', docText, 'foo');
      expect(result).toBe('**foo()**\n\nperforms an operation\nMore details here');
    });

    test('removes heading with name but no description', () => {
      const docText = '## foo\nSome details';
      const result = formatDoc('foo()', docText, 'foo');
      expect(result).toBe('**foo()**\n\nSome details');
    });

    test('preserves headings without the symbol name', () => {
      const docText = '# Overview\nThis is the overview';
      const result = formatDoc('bar()', docText, 'bar');
      expect(result).toBe('**bar()**\n\n# Overview\nThis is the overview');
    });

    test('handles markdown formatting in headings', () => {
      const docText = '# `foo`: **does** something\nDetails';
      const result = formatDoc('foo()', docText, 'foo');
      expect(result).toBe('**foo()**\n\ndoes something\nDetails');
    });
  });

  describe('findSignatureAfter', () => {
    test('finds function signature', () => {
      const lines = ['', 'void foo(int x, double y) {', '  // body'];
      const result = findSignatureAfter(lines, 0);
      expect(result).toEqual({
        name: 'foo',
        signature: 'foo(int x, double y)'
      });
    });

    test('finds multi-line function signature', () => {
      const lines = [
        '',
        'static inline double',
        'calculate_value(double a,',
        '                double b) {',
        '  return a + b;'
      ];
      const result = findSignatureAfter(lines, 0);
      expect(result).toEqual({
        name: 'calculate_value',
        signature: 'calculate_value(double a, double b)'
      });
    });

    test('finds #define macro with parameters', () => {
      const lines = ['', '#define MAX(a, b) ((a) > (b) ? (a) : (b))'];
      const result = findSignatureAfter(lines, 0);
      expect(result).toEqual({
        name: 'MAX',
        signature: 'MAX(a, b)'
      });
    });

    test('finds #define constant without parameters', () => {
      const lines = ['', '#define PI 3.14159'];
      const result = findSignatureAfter(lines, 0);
      expect(result).toEqual({
        name: 'PI',
        signature: 'PI'
      });
    });

    test('finds macro keyword signature', () => {
      const lines = ['', 'macro reduce (sum, int)'];
      const result = findSignatureAfter(lines, 0);
      expect(result).toEqual({
        name: 'reduce',
        signature: 'reduce(sum, int)'
      });
    });

    test('skips modifier-only lines', () => {
      const lines = ['', 'static', 'inline', 'trace', 'void foo() {'];
      const result = findSignatureAfter(lines, 0);
      expect(result).toEqual({
        name: 'foo',
        signature: 'foo()'
      });
    });

    test('skips comment lines', () => {
      const lines = ['', '// This is a comment', 'void bar() {'];
      const result = findSignatureAfter(lines, 0);
      expect(result).toEqual({
        name: 'bar',
        signature: 'bar()'
      });
    });

    test('returns null for #include', () => {
      const lines = ['', '#include <stdio.h>'];
      const result = findSignatureAfter(lines, 0);
      expect(result).toBeNull();
    });

    test('returns null for #pragma', () => {
      const lines = ['', '#pragma once'];
      const result = findSignatureAfter(lines, 0);
      expect(result).toBeNull();
    });

    test('stops at MAX_LOOKAHEAD_LINES', () => {
      const lines = Array(50).fill('');
      const result = findSignatureAfter(lines, 0);
      expect(result).toBeNull();
    });

    test('handles signature ending with semicolon', () => {
      const lines = ['', 'void foo(int x);'];
      const result = findSignatureAfter(lines, 0);
      expect(result).toEqual({
        name: 'foo',
        signature: 'foo(int x)'
      });
    });
  });

  describe('splitTopLevelCommas', () => {
    test('splits simple comma-separated list', () => {
      const result = splitTopLevelCommas('a, b, c');
      expect(result).toEqual(['a', 'b', 'c']);
    });

    test('ignores commas inside parentheses', () => {
      const result = splitTopLevelCommas('func(a, b), x, y');
      expect(result).toEqual(['func(a, b)', 'x', 'y']);
    });

    test('ignores commas inside brackets', () => {
      const result = splitTopLevelCommas('arr[1, 2], other');
      expect(result).toEqual(['arr[1, 2]', 'other']);
    });

    test('ignores commas inside braces', () => {
      const result = splitTopLevelCommas('{a, b}, c');
      expect(result).toEqual(['{a, b}', 'c']);
    });

    test('ignores commas in string literals', () => {
      const result = splitTopLevelCommas('"hello, world", x');
      expect(result).toEqual(['"hello, world"', 'x']);
    });

    test('ignores commas in char literals', () => {
      const result = splitTopLevelCommas("',', x");
      expect(result).toEqual(["','", 'x']);
    });

    test('handles escaped quotes', () => {
      const result = splitTopLevelCommas('"escaped\\"quote", x');
      expect(result).toEqual(['"escaped\\"quote"', 'x']);
    });

    test('handles nested delimiters', () => {
      const result = splitTopLevelCommas('func((a, b), [c, d]), e');
      expect(result).toEqual(['func((a, b), [c, d])', 'e']);
    });

    test('trims whitespace', () => {
      const result = splitTopLevelCommas('  a  ,  b  ,  c  ');
      expect(result).toEqual(['a', 'b', 'c']);
    });

    test('handles empty input', () => {
      const result = splitTopLevelCommas('');
      expect(result).toEqual([]);
    });
  });

  describe('parseDeclaration', () => {
    test('parses simple identifier', () => {
      const result = parseDeclaration('foo');
      expect(result).toEqual({ name: 'foo', suffix: '' });
    });

    test('parses pointer', () => {
      const result = parseDeclaration('*ptr');
      expect(result).toEqual({ name: 'ptr', suffix: '' });
    });

    test('parses array with single dimension', () => {
      const result = parseDeclaration('arr[10]');
      expect(result).toEqual({ name: 'arr', suffix: '[10]' });
    });

    test('parses multi-dimensional array', () => {
      const result = parseDeclaration('matrix[3][4]');
      expect(result).toEqual({ name: 'matrix', suffix: '[3][4]' });
    });

    test('parses declaration with initializer', () => {
      const result = parseDeclaration('x = 42');
      expect(result).toEqual({ name: 'x', suffix: '' });
    });

    test('parses array with initializer', () => {
      const result = parseDeclaration('arr[5] = {1, 2, 3}');
      expect(result).toEqual({ name: 'arr', suffix: '[5]' });
    });

    test('handles leading whitespace and asterisks', () => {
      const result = parseDeclaration('  **ptr');
      expect(result).toEqual({ name: 'ptr', suffix: '' });
    });

    test('returns null for invalid identifier', () => {
      const result = parseDeclaration('123invalid');
      expect(result).toBeNull();
    });

    test('returns null for empty string', () => {
      const result = parseDeclaration('');
      expect(result).toBeNull();
    });
  });

  describe('isModifierLine', () => {
    test('recognizes trace modifier', () => {
      expect(isModifierLine('trace')).toBe(true);
      expect(isModifierLine('  trace  ')).toBe(true);
    });

    test('recognizes static modifier', () => {
      expect(isModifierLine('static')).toBe(true);
    });

    test('recognizes inline modifier', () => {
      expect(isModifierLine('inline')).toBe(true);
    });

    test('recognizes extern modifier', () => {
      expect(isModifierLine('extern')).toBe(true);
    });

    test('recognizes const modifier', () => {
      expect(isModifierLine('const')).toBe(true);
    });

    test('returns false for non-modifier', () => {
      expect(isModifierLine('void')).toBe(false);
      expect(isModifierLine('int x')).toBe(false);
      expect(isModifierLine('static int')).toBe(false);
    });
  });

  describe('parseDocsFromFile', () => {
    test('extracts doc comment with function signature', () => {
      const content = `
/**
 * Calculates the sum of two numbers
 * @param a First number
 * @param b Second number
 */
int add(int a, int b) {
  return a + b;
}
`;
      const entries = parseDocsFromFile(content, 'test.c');
      expect(entries).toHaveLength(1);
      expect(entries[0].symbol).toBe('add');
      expect(entries[0].signature).toBe('add(int a, int b)');
      expect(entries[0].markdown).toContain('**add(int a, int b)**');
      expect(entries[0].markdown).toContain('Calculates the sum');
    });

    test('extracts multiple doc comments', () => {
      const content = `
/** Function one */
void foo() {}

/** Function two */
void bar() {}
`;
      const entries = parseDocsFromFile(content, 'test.c');
      expect(entries).toHaveLength(2);
      expect(entries[0].symbol).toBe('foo');
      expect(entries[1].symbol).toBe('bar');
    });

    test('skips doc comments before #include', () => {
      const content = `
/** This should be ignored */
#include <stdio.h>
`;
      const entries = parseDocsFromFile(content, 'test.c');
      expect(entries).toHaveLength(0);
    });

    test('extracts doc comment for #define', () => {
      const content = `
/**
 * Maximum of two values
 */
#define MAX(a, b) ((a) > (b) ? (a) : (b))
`;
      const entries = parseDocsFromFile(content, 'test.c');
      expect(entries).toHaveLength(1);
      expect(entries[0].symbol).toBe('MAX');
      expect(entries[0].signature).toBe('MAX(a, b)');
    });

    test('handles multi-line function signatures', () => {
      const content = `
/** Multi-line signature */
static inline double
calculate(double x,
          double y) {
  return x * y;
}
`;
      const entries = parseDocsFromFile(content, 'test.c');
      expect(entries).toHaveLength(1);
      expect(entries[0].symbol).toBe('calculate');
      expect(entries[0].signature).toBe('calculate(double x, double y)');
    });

    test('handles doxygen-style /*! comments', () => {
      const content = `
/*! Brief description */
void test() {}
`;
      const entries = parseDocsFromFile(content, 'test.c');
      expect(entries).toHaveLength(1);
      expect(entries[0].symbol).toBe('test');
      expect(entries[0].markdown).toContain('Brief description');
    });

    test('skips incomplete doc comments', () => {
      const content = `
/** This comment never closes
void foo() {}
`;
      const entries = parseDocsFromFile(content, 'test.c');
      expect(entries).toHaveLength(0);
    });
  });

  describe('parseGlobalsFromFile', () => {
    test('extracts simple global variable', () => {
      const content = 'int counter;\n';
      const entries = parseGlobalsFromFile(content, 'test.c');
      expect(entries).toHaveLength(1);
      expect(entries[0].symbol).toBe('counter');
      expect(entries[0].signature).toBe('int counter');
      expect(entries[0].markdown).toBe('**int counter**');
    });

    test('extracts multiple declarations in one line', () => {
      const content = 'int a, b, c;\n';
      const entries = parseGlobalsFromFile(content, 'test.c');
      expect(entries).toHaveLength(3);
      expect(entries[0].symbol).toBe('a');
      expect(entries[1].symbol).toBe('b');
      expect(entries[2].symbol).toBe('c');
    });

    test('extracts pointer declarations', () => {
      const content = 'char *str, *name;\n';
      const entries = parseGlobalsFromFile(content, 'test.c');
      expect(entries).toHaveLength(2);
      expect(entries[0].symbol).toBe('str');
      expect(entries[1].symbol).toBe('name');
    });

    test('extracts array declarations', () => {
      const content = 'double matrix[3][4], vector[10];\n';
      const entries = parseGlobalsFromFile(content, 'test.c');
      expect(entries).toHaveLength(2);
      expect(entries[0].symbol).toBe('matrix');
      expect(entries[0].signature).toBe('double matrix[3][4]');
      expect(entries[1].symbol).toBe('vector');
      expect(entries[1].signature).toBe('double vector[10]');
    });

    test('includes doc comment when present', () => {
      const content = `
/** The global counter */
int counter;
`;
      const entries = parseGlobalsFromFile(content, 'test.c');
      expect(entries).toHaveLength(1);
      expect(entries[0].markdown).toContain('The global counter');
    });

    test('handles const qualifier', () => {
      const content = 'const double PI = 3.14159;\n';
      const entries = parseGlobalsFromFile(content, 'test.c');
      expect(entries).toHaveLength(1);
      expect(entries[0].symbol).toBe('PI');
      expect(entries[0].signature).toBe('double PI');
    });

    test('handles static qualifier', () => {
      const content = 'static int internal;\n';
      const entries = parseGlobalsFromFile(content, 'test.c');
      expect(entries).toHaveLength(1);
      expect(entries[0].symbol).toBe('internal');
    });

    test('skips declarations inside functions', () => {
      const content = `
void foo() {
  int local = 0;
}
`;
      const entries = parseGlobalsFromFile(content, 'test.c');
      expect(entries).toHaveLength(0);
    });

    test('skips declarations inside structs', () => {
      const content = `
struct Point {
  double x;
  double y;
};
`;
      const entries = parseGlobalsFromFile(content, 'test.c');
      expect(entries).toHaveLength(0);
    });

    test('handles multiple types', () => {
      const content = `
int a;
double b;
float c;
long d;
short e;
unsigned f;
size_t g;
bool h;
`;
      const entries = parseGlobalsFromFile(content, 'test.c');
      expect(entries).toHaveLength(8);
      expect(entries[0].signature).toBe('int a');
      expect(entries[1].signature).toBe('double b');
      expect(entries[7].signature).toBe('bool h');
    });

    test('ignores block comments', () => {
      const content = `
/* int commented_out; */
int real_var;
`;
      const entries = parseGlobalsFromFile(content, 'test.c');
      expect(entries).toHaveLength(1);
      expect(entries[0].symbol).toBe('real_var');
    });

    test('ignores line comments', () => {
      const content = `
// int commented_out;
int real_var;
`;
      const entries = parseGlobalsFromFile(content, 'test.c');
      expect(entries).toHaveLength(1);
      expect(entries[0].symbol).toBe('real_var');
    });

    test('handles strings with semicolons', () => {
      const content = `
char *msg = "hello; world";
int valid;
`;
      const entries = parseGlobalsFromFile(content, 'test.c');
      expect(entries).toHaveLength(2);
      expect(entries[0].symbol).toBe('msg');
      expect(entries[1].symbol).toBe('valid');
    });
  });

  describe('integration tests', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'basilisk-test-'));
    });

    afterEach(async () => {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    test('loads docs from Basilisk source directory', async () => {
      // Create mock Basilisk source structure
      const srcDir = path.join(tempDir, 'src');
      await fs.promises.mkdir(srcDir);

      // Create marker files to identify as Basilisk source
      await fs.promises.writeFile(path.join(srcDir, 'fractions.h'), '// marker');

      // Create a documented function
      const content = `
/**
 * Initializes the simulation grid
 */
void init_grid() {
  // implementation
}
`;
      await fs.promises.writeFile(path.join(srcDir, 'grid.c'), content);

      await ensureBasiliskDocs([tempDir]);
      const doc = getBasiliskDoc('init_grid');

      expect(doc).toBeDefined();
      expect(doc?.symbol).toBe('init_grid');
      expect(doc?.signature).toBe('init_grid()');
      expect(doc?.markdown).toContain('Initializes the simulation grid');
    });

    test('prefers longer documentation', async () => {
      const srcDir = path.join(tempDir, 'src');
      await fs.promises.mkdir(srcDir);
      await fs.promises.writeFile(path.join(srcDir, 'fractions.h'), '// marker');

      // First file with short doc
      await fs.promises.writeFile(
        path.join(srcDir, 'file1.c'),
        '/** Short */\nvoid foo() {}\n'
      );

      // Second file with longer doc
      await fs.promises.writeFile(
        path.join(srcDir, 'file2.c'),
        '/** Longer documentation with more details */\nvoid foo() {}\n'
      );

      await ensureBasiliskDocs([tempDir]);
      const doc = getBasiliskDoc('foo');

      expect(doc).toBeDefined();
      expect(doc?.markdown).toContain('Longer documentation');
    });

    test('returns undefined for non-existent symbol', async () => {
      await ensureBasiliskDocs([]);
      const doc = getBasiliskDoc('nonexistent');
      expect(doc).toBeUndefined();
    });

    test('handles empty roots', async () => {
      await ensureBasiliskDocs([]);
      const doc = getBasiliskDoc('anything');
      expect(doc).toBeUndefined();
    });

    test('handles non-existent directory', async () => {
      await ensureBasiliskDocs(['/nonexistent/path']);
      const doc = getBasiliskDoc('anything');
      expect(doc).toBeUndefined();
    });

    test('deduplicates identical roots', async () => {
      const srcDir = path.join(tempDir, 'src');
      await fs.promises.mkdir(srcDir);
      await fs.promises.writeFile(path.join(srcDir, 'fractions.h'), '// marker');
      await fs.promises.writeFile(
        path.join(srcDir, 'test.c'),
        '/** Test */\nvoid test() {}\n'
      );

      // Pass same root multiple times with different separators
      await ensureBasiliskDocs([tempDir, tempDir + '/', path.resolve(tempDir)]);
      const doc = getBasiliskDoc('test');

      expect(doc).toBeDefined();
      // Should only load once, not crash or duplicate
    });

    test('caches docs across calls with same roots', async () => {
      const srcDir = path.join(tempDir, 'src');
      await fs.promises.mkdir(srcDir);
      await fs.promises.writeFile(path.join(srcDir, 'fractions.h'), '// marker');
      await fs.promises.writeFile(
        path.join(srcDir, 'test.c'),
        '/** Test */\nvoid test() {}\n'
      );

      await ensureBasiliskDocs([tempDir]);
      const doc1 = getBasiliskDoc('test');

      // Second call should use cache
      await ensureBasiliskDocs([tempDir]);
      const doc2 = getBasiliskDoc('test');

      expect(doc1).toEqual(doc2);
    });

    test('reloads when roots change', async () => {
      const srcDir1 = path.join(tempDir, 'src1');
      const srcDir2 = path.join(tempDir, 'src2');
      await fs.promises.mkdir(srcDir1);
      await fs.promises.mkdir(srcDir2);
      await fs.promises.writeFile(path.join(srcDir1, 'fractions.h'), '// marker');
      await fs.promises.writeFile(path.join(srcDir2, 'fractions.h'), '// marker');
      await fs.promises.writeFile(
        path.join(srcDir1, 'test.c'),
        '/** From src1 */\nvoid foo() {}\n'
      );
      await fs.promises.writeFile(
        path.join(srcDir2, 'test.c'),
        '/** From src2 */\nvoid bar() {}\n'
      );

      await ensureBasiliskDocs([path.join(tempDir, 'src1')]);
      expect(getBasiliskDoc('foo')).toBeDefined();
      expect(getBasiliskDoc('bar')).toBeUndefined();

      await ensureBasiliskDocs([path.join(tempDir, 'src2')]);
      expect(getBasiliskDoc('foo')).toBeUndefined();
      expect(getBasiliskDoc('bar')).toBeDefined();
    });
  });
});
