/*************************************************************
 *
 *  MathJax/jax/input/TeX/ParserUtil.js
 *
 *  Implements the TeX InputJax that reads mathematics in
 *  TeX and LaTeX format and converts it to the MML ElementJax
 *  internal format.
 *
 *  ---------------------------------------------------------------------
 *
 *  Copyright (c) 2009-2017 The MathJax Consortium
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */


/**
 * @fileoverview A namespace for utility functions for the TeX Parser.
 *
 * @author v.sorge@mathjax.org (Volker Sorge)
 */

import {TEXCLASS, MmlNode} from '../../core/MmlTree/MmlNode.js';
import {MmlMo} from '../../core/MmlTree/MmlNodes/mo.js';
import {EnvList} from './StackItem.js';
import {ArrayItem} from './BaseItems.js';
import {TreeHelper} from './TreeHelper.js';
import TexParser from './TexParser.js';
import TexError from './TexError.js';


namespace ParseUtil {

  // TODO (VS): Combine some of this with lengths in util.
  const emPerInch = 7.2;
  const pxPerInch = 72;
  const UNIT_CASES: {[key: string]: ((m: number) => number)}  = {
    'em': m => m,
    'ex': m => m * .43,
    'pt': m => m / 10,                    // 10 pt to an em
    'pc': m => m * 1.2,                   // 12 pt to a pc
    'px': m => m * emPerInch / pxPerInch,
    'in': m => m * emPerInch,
    'cm': m => m * emPerInch / 2.54, // 2.54 cm to an inch
    'mm': m => m * emPerInch / 25.4, // 10 mm to a cm
    'mu': m => m / 18,
  };
  const num = '([-+]?([.,]\\d+|\\d+([.,]\\d*)?))';
  const unit = '(pt|em|ex|mu|px|mm|cm|in|pc)';
  const dimenEnd = RegExp('^\\s*' + num + '\\s*' + unit + '\\s*$');
  const dimenRest = RegExp('^\\s*' + num + '\\s*' + unit + ' ?');


  /**
   * Matches for a dimension argument.
   * @param {string} dim The argument.
   * @param {boolean} rest Allow for trailing garbage in the dimension string.
   * @return {[string, string, number]} The match result as (Anglosaxon) value,
   *     unit name, length of matched string. The latter is interesting in the
   *     case of trailing garbage.
   */
  export function matchDimen(
    dim: string, rest: boolean = false): [string, string, number] {
    let match = dim.match(rest ? dimenRest : dimenEnd);
    return match ? [match[1].replace(/,/, '.'), match[4], match[0].length] :
      [null, null, 0];
  }


  /**
   * Convert a dimension string into standard em dimension.
   * @param {}
   * @return {}
   */
  export function dimen2em(dim: string) {
    let [value, unit, _] = matchDimen(dim);
    let m = parseFloat(value || '1');
    let func = UNIT_CASES[unit];
    return func ? func(m) : 0;
  }


  export function Em(m: number) {
    if (Math.abs(m) < .0006) {
      return '0em';
    }
    return m.toFixed(3).replace(/\.?0+$/, '') + 'em';
  }


  /**
   *  Create an mrow that has stretchy delimiters at either end, as needed
   */
  export function fenced(open: string, mml: MmlNode, close: string) {
    TreeHelper.printMethod('fenced');
    // @test Fenced, Fenced3
    let mrow = TreeHelper.createNode(
      'mrow', [], {open: open, close: close, texClass: TEXCLASS.INNER});
    let openNode = TreeHelper.createText(open);
    let mo = TreeHelper.createNode(
      'mo', [],
      {fence: true, stretchy: true, symmetric: true, texClass: TEXCLASS.OPEN},
      openNode);
    TreeHelper.appendChildren(mrow, [mo]);
    if (TreeHelper.isType(mml, 'mrow') && TreeHelper.isInferred(mml)) {
      // @test Fenced, Middle
      TreeHelper.appendChildren(mrow, TreeHelper.getChildren(mml));
    } else {
      // @test Fenced3
      TreeHelper.appendChildren(mrow, [mml]);
    }
    let closeNode = TreeHelper.createText(close);
    mo = TreeHelper.createNode(
      'mo', [],
      {fence: true, stretchy: true, symmetric: true, texClass: TEXCLASS.CLOSE},
      closeNode);
    TreeHelper.appendChildren(mrow, [mo]);
    return mrow;
  }


  /**
   *  Create an mrow that has \mathchoice using \bigg and \big for the delimiters
   */
  export function fixedFence(open: string, mml: MmlNode, close: string) {
    // @test Choose, Over With Delims, Above with Delims
    TreeHelper.printMethod('fixedFence');
    let mrow = TreeHelper.createNode(
      'mrow', [], {open: open, close: close, texClass: TEXCLASS.ORD});
    if (open) {
      TreeHelper.appendChildren(mrow, [mathPalette(open, 'l')]);
    }
    if (TreeHelper.isType(mml, 'mrow')) {
      TreeHelper.appendChildren(mrow, TreeHelper.getChildren(mml));
    } else {
      TreeHelper.appendChildren(mrow, [mml]);
    }
    if (close) {
      TreeHelper.appendChildren(mrow, [mathPalette(close, 'r')]);
    }
    return mrow;
  }


  export function mathPalette(fence: string, side: string) {
    TreeHelper.printMethod('mathPalette');
    if (fence === '{' || fence === '}') {
      fence = '\\' + fence;
    }
    let D = '{\\bigg' + side + ' ' + fence + '}';
    let T = '{\\big' + side + ' ' + fence + '}';
    return new TexParser('\\mathchoice' + D + T + T + T, {}).mml();
  }


  /**
   *  If the initial child, skipping any initial space or
   *  empty braces (TeXAtom with child being an empty inferred row),
   *  is an <mo>, preceed it by an empty <mi> to force the <mo> to
   *  be infix.
   */
  export function fixInitialMO(nodes: MmlNode[]) {
    TreeHelper.printMethod('AMS-fixInitialMO');
    for (let i = 0, m = nodes.length; i < m; i++) {
      let child = nodes[i];
      if (child && (!TreeHelper.isType(child, 'mspace') &&
                    (!TreeHelper.isType(child, 'TeXAtom') ||
                     (TreeHelper.getChildren(child)[0] &&
                      TreeHelper.getChildren(TreeHelper.getChildren(child)[0]).length)))) {
        if (TreeHelper.isEmbellished(child)) {
          let mi = TreeHelper.createNode('mi', [], {});
          nodes.unshift(mi);
        }
        break;
      }
    }
  }


  export function mi2mo(mi: MmlNode) {
    TreeHelper.printMethod('mi2mo');
    // @test Mathop Sub, Mathop Super
    const mo = TreeHelper.createNode('mo', [], {});
    TreeHelper.copyChildren(mi, mo);
    TreeHelper.copyAttributes(mi, mo);
    TreeHelper.setProperties(mo, {lspace: '0', rspace: '0'});
    TreeHelper.removeProperties(mo, 'movesupsub');
    return mo;
  }


  /**
   *  Break up a string into text and math blocks
   * @param {TexParser} parser The calling parser.
   * @param {string} text The text in the math expression to parse.
   * @param {number|string=} level The scriptlevel.
   */
  // TODO: Write tests!
  export function internalMath(parser: TexParser, text: string, level?: number|string) {
    TreeHelper.printMethod('InternalMath (Old Parser Object)');
    let def = (parser.stack.env['font'] ? {mathvariant: parser.stack.env['font']} : {});
    let mml: MmlNode[] = [], i = 0, k = 0, c, node, match = '', braces = 0;
    if (text.match(/\\?[${}\\]|\\\(|\\(eq)?ref\s*\{/)) {
      while (i < text.length) {
        c = text.charAt(i++);
        if (c === '$') {
          if (match === '$' && braces === 0) {
            // @test Interspersed Text
            node = TreeHelper.createNode('TeXAtom',
                                         [(new TexParser(text.slice(k, i - 1), {})).mml()], {});
            mml.push(node);
            match = '';
            k = i;
          } else if (match === '') {
            // @test Interspersed Text
            if (k < i - 1) {
              mml.push(internalText(text.slice(k, i - 1), def));
            }
            match = '$';
            k = i;
          }
        } else if (c === '{' && match !== '') {
          // TODO: write test: a\mbox{ b $a\mbox{ b c } c$ c } c
          braces++;
        } else if (c === '}') {
          if (match === '}' && braces === 0) {
            // TODO: test a\mbox{ \eqref{1} } c
            node = TreeHelper.createNode('TeXAtom', [(new TexParser(text.slice(k, i), {})).mml()], def);
            mml.push(node);
            match = '';
            k = i;
          } else if (match !== '') {
            // TODO: test: a\mbox{ ${ab}$ } c
            if (braces) {
              // TODO: test: a\mbox{ ${ab}$ } c
              braces--;
            }
          }
        } else if (c === '\\') {
          // TODO: test a\mbox{aa \\ bb} c
          if (match === '' && text.substr(i).match(/^(eq)?ref\s*\{/)) {
            // TODO: test a\mbox{ \eqref{1} } c
            // (check once eqref is implemented)
            let len = ((RegExp as any)['$&'] as string).length;
            if (k < i - 1) {
              // TODO: test a\mbox{ \eqref{1} } c
              mml.push(internalText(text.slice(k, i - 1), def));
            }
            match = '}';
            k = i - 1;
            i += len;
          } else {
            c = text.charAt(i++);
            if (c === '(' && match === '') {
              if (k < i - 2) {
                mml.push(internalText(text.slice(k, i - 2), def));
              }
              match = ')'; k = i;
            } else if (c === ')' && match === ')' && braces === 0) {
              node = TreeHelper.createNode('TeXAtom', [(new TexParser(text.slice(k, i - 2), {})).mml()], {});
              mml.push(node);
              match = '';
              k = i;
            } else if (c.match(/[${}\\]/) && match === '')  {
              // TODO: test  a\mbox{aa \\ bb} c
              i--;
              text = text.substr(0, i - 1) + text.substr(i); // remove \ from \$, \{, \}, or \\
            }
          }
        }
      }
      if (match !== '') {
        // TODO: test a\mbox{$}} c
        throw new TexError(['MathNotTerminated', 'Math not terminated in text box']);
      }
    }
    if (k < text.length) {
      mml.push(internalText(text.slice(k), def));
    }
    if (level != null) {
      // @test Label, Fbox, Hbox
      mml = [TreeHelper.createNode('mstyle', mml, {displaystyle: false, scriptlevel: level})];
    } else if (mml.length > 1) {
      // @test Interspersed Text
      mml = [TreeHelper.createNode('mrow', mml, {})];
    }
    return mml;
  }

  const NBSP = '\u00A0';

  function internalText(text: string, def: EnvList) {
    // @test Label, Fbox, Hbox
    TreeHelper.printMethod('InternalText (Old Parser Object)');
    text = text.replace(/^\s+/, NBSP).replace(/\s+$/, NBSP);
    let textNode = TreeHelper.createText(text);
    return TreeHelper.createNode('mtext', [], def, textNode);
  }

  /**
   * Trim spaces from a string.
   * @param {string} text The string to clean.
   * @return {string} The string with leading and trailing whitespace removed.
   */
  export function trimSpaces(text: string): string {
    TreeHelper.printMethod('trimSpaces (Old Parser Object)');
    if (typeof(text) !== 'string') {
      return text;
    }
    let TEXT = text.replace(/^\s+|\s+$/g, '');
    if (TEXT.match(/\\$/) && text.match(/ $/)) {
      TEXT += ' ';
    }
    return TEXT;
  }

  /**
   * Sets alignment in array definitions.
   */
  export function setArrayAlign(array: ArrayItem, align: string) {
    TreeHelper.printMethod('setArrayAlign');
    // @test Array1, Array2, Array Test
    align = ParseUtil.trimSpaces(align || '');
    if (align === 't') {
      array.arraydef.align = 'baseline 1';
    } else if (align === 'b') {
      array.arraydef.align = 'baseline -1';
    } else if (align === 'c') {
      array.arraydef.align = 'center';
    } else if (align) {
      array.arraydef.align = align;
    } // FIXME: should be an error?
    return array;
  }


  let MAXBUFFER = 5 * 1024;   // maximum size of TeX string to process

  /**
   *  Replace macro parameters with their values
   */
  export function substituteArgs(args: string[], str: string) {
    TreeHelper.printMethod('SubstituteArgs');
    let text = '';
    let newstring = '';
    let i = 0;
    while (i < str.length) {
      let c = str.charAt(i++);
      if (c === '\\') {
        text += c + str.charAt(i++);
      }
      else if (c === '#') {
        c = str.charAt(i++);
        if (c === '#') {
          text += c;
        } else {
          if (!c.match(/[1-9]/) || parseInt(c, 10) > args.length) {
            throw new TexError(['IllegalMacroParam',
                                'Illegal macro parameter reference']);
          }
          newstring = addArgs(addArgs(newstring, text),
                              args[parseInt(c, 10) - 1]);
          text = '';
        }
      } else {
        text += c;
      }
    }
    return addArgs(newstring, text);
  }


  /**
   *  Make sure that macros are followed by a space if their names
   *  could accidentally be continued into the following text.
   */
  export function addArgs(s1: string, s2: string) {
    TreeHelper.printMethod('AddArgs');
    if (s2.match(/^[a-z]/i) && s1.match(/(^|[^\\])(\\\\)*\\[a-z]+$/i)) {
      s1 += ' ';
    }
    if (s1.length + s2.length > MAXBUFFER) {
      throw new TexError(['MaxBufferSize',
                          'MathJax internal buffer size exceeded; is there a' +
                          ' recursive macro call?']);
    }
    return s1 + s2;
  }


  /**
   *  Check for bad nesting of equation environments
   */
  export function checkEqnEnv(parser: TexParser) {
    if (parser.stack.global.eqnenv) {
      throw new TexError(['ErroneousNestingEq', 'Erroneous nesting of equation structures']);
    }
    parser.stack.global.eqnenv = true;
  };

  /**
   * This is a placeholder for future security filtering of attributes.
   * @param {TexParser} parser The current parser.
   * @param {string} name The attribute name.
   * @param {string} value The attribute value to filter.
   * @return {string} The filtered value.
   */
  export function MmlFilterAttribute(parser: TexParser, name: string, value: string): string {
    // TODO: Implement this.
    return value;
  };

}

export default ParseUtil;
