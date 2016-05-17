/**
 * A handy class to calculate color values.
 *
 * @version 1.0
 * @author Robert Eisele <robert@xarg.org>
 * @copyright Copyright (c) 2010, Robert Eisele
 * @link http://www.xarg.org/2010/03/generate-client-side-png-files-using-javascript/
 * @license http://www.opensource.org/licenses/bsd-license.php BSD License
 *
 */

// Modified by George Chan <gchan@21cn.com>

// Module systems magic dance
(function (definition) {
    // RequireJS
    if (typeof define == "function") {
        define(definition);
    // YUI3
    } else if (typeof YUI == "function") {
        YUI.add("es5", definition);
    // Node.js
    } else if (typeof module === "object" && typeof require === "function") {
      module.exports = definition;
    // CommonJS and <script>
    } else {
        window.PNGlib = definition;
    }
})(function(width,height,depth) {


    // helper functions for that ctx
    function write(buffer, offs) {
        for (var i = 2; i < arguments.length; i++) {
            for (var j = 0; j < arguments[i].length; j++) {
                buffer[offs++] = arguments[i][j];
            }
        }
    }

    function byte2(w) {
        return [(w >> 8) & 255, w & 255];
    }

    function byte4(w) {
        return [(w >> 24) & 255, (w >> 16) & 255, (w >> 8) & 255, w & 255];
    }

    function byte2lsb(w) {
        return [w & 255, (w >> 8) & 255];
    }
    
    function strbuf(s) {
      var buf = new Uint8Array(s.length);
      for (var i = 0; i < s.length; i++) {
        buf[i] = s.charCodeAt(i);
      }
      return buf;
    }

    this.width   = width;
    this.height  = height;
    this.depth   = depth;

    // pixel data and row filter identifier size
    this.pix_size = height * (width + 1);

    // deflate header, pix_size, block headers, adler32 checksum
    this.data_size = 2 + this.pix_size + 5 * Math.floor((0xfffe + this.pix_size) / 0xffff) + 4;

    // offsets and sizes of Png chunks
    this.ihdr_offs = 0;									// IHDR offset and size
    this.ihdr_size = 4 + 4 + 13 + 4;
    this.plte_offs = this.ihdr_offs + this.ihdr_size;	// PLTE offset and size
    this.plte_size = 4 + 4 + 3 * depth + 4;
    this.trns_offs = this.plte_offs + this.plte_size;	// tRNS offset and size
    this.trns_size = 4 + 4 + depth + 4;
    this.idat_offs = this.trns_offs + this.trns_size;	// IDAT offset and size
    this.idat_size = 4 + 4 + this.data_size + 4;
    this.iend_offs = this.idat_offs + this.idat_size;	// IEND offset and size
    this.iend_size = 4 + 4 + 4;
    this.buffer_size  = this.iend_offs + this.iend_size;	// total PNG size

    this.buffer  = new Uint8Array(this.buffer_size);
    this.palette = {};
    this.pindex  = 0;

    var _crc32 = new Array();

    // initialize non-zero elements
    write(this.buffer, this.ihdr_offs, byte4(this.ihdr_size - 12), strbuf('IHDR'), byte4(width), byte4(height), [8, 3]);
    write(this.buffer, this.plte_offs, byte4(this.plte_size - 12), strbuf('PLTE'));
    write(this.buffer, this.trns_offs, byte4(this.trns_size - 12), strbuf('tRNS'));
    write(this.buffer, this.idat_offs, byte4(this.idat_size - 12), strbuf('IDAT'));
    write(this.buffer, this.iend_offs, byte4(this.iend_size - 12), strbuf('IEND'));

    // initialize deflate header
    var header = ((8 + (7 << 4)) << 8) | (3 << 6);
    header+= 31 - (header % 31);

    write(this.buffer, this.idat_offs + 8, byte2(header));

    // initialize deflate block headers
    for (var i = 0; (i << 16) - 1 < this.pix_size; i++) {
        var size, bits;
        if (i + 0xffff < this.pix_size) {
            size = 0xffff;
            bits = 0;
        } else {
            size = this.pix_size - (i << 16) - i;
            bits = 1;
        }
        write(this.buffer, this.idat_offs + 8 + 2 + (i << 16) + (i << 2), [bits], byte2lsb(size), byte2lsb(~size));
    }

    /* Create crc32 lookup table */
    for (var i = 0; i < 256; i++) {
        var c = i;
        for (var j = 0; j < 8; j++) {
            if (c & 1) {
                c = -306674912 ^ ((c >> 1) & 0x7fffffff);
            } else {
                c = (c >> 1) & 0x7fffffff;
            }
        }
        _crc32[i] = c;
    }

    // compute the index into a png for a given pixel
    this.index = function(x,y) {
        var i = y * (this.width + 1) + x + 1;
        var j = this.idat_offs + 8 + 2 + 5 * Math.floor((i / 0xffff) + 1) + i;
        return j;
    }

    // convert a color and build up the palette
    this.color = function(red, green, blue, alpha) {

        alpha = alpha >= 0 ? alpha : 255;
        var color = (((((alpha << 8) | red) << 8) | green) << 8) | blue;

        if (typeof this.palette[color] == "undefined") {
            if (this.pindex == this.depth) return 0;

            var ndx = this.plte_offs + 8 + 3 * this.pindex;

            this.buffer[ndx + 0] = Math.floor(red);
            this.buffer[ndx + 1] = Math.floor(green);
            this.buffer[ndx + 2] = Math.floor(blue);
            this.buffer[this.trns_offs+8+this.pindex] = Math.floor(alpha);

            this.palette[color] = this.pindex++;
        }
        return this.palette[color];
    }

    // output a PNG string, Base64 encoded
    this.getBase64 = function() {

        var s = this.getPNGBuffer();

        var ch = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
        var c1, c2, c3, e1, e2, e3, e4;
        var l = s.length;
        var i = 0;
        var r = "";

        do {
            c1 = s[i];
            e1 = c1 >> 2;
            c2 = s[i+1];
            e2 = ((c1 & 3) << 4) | (c2 >> 4);
            c3 = s[i+2];
            if (l < i+2) { e3 = 64; } else { e3 = ((c2 & 0xf) << 2) | (c3 >> 6); }
            if (l < i+3) { e4 = 64; } else { e4 = c3 & 0x3f; }
            r+= ch.charAt(e1) + ch.charAt(e2) + ch.charAt(e3) + ch.charAt(e4);
        } while ((i+= 3) < l);
        return r;
    }

    this.getPNGBuffer = function() {
    
      var MAGIC_STR = [ 137, 80, 78, 71, 13, 10, 26, 10 ];

        // compute adler32 of output pixels + row filter bytes
        var BASE = 65521; /* largest prime smaller than 65536 */
        var NMAX = 5552;  /* NMAX is the largest n such that 255n(n+1)/2 + (n+1)(BASE-1) <= 2^32-1 */
        var s1 = 1;
        var s2 = 0;
        var n = NMAX;

        for (var y = 0; y < this.height; y++) {
            for (var x = -1; x < this.width; x++) {
                s1+= this.buffer[this.index(x, y)];
                s2+= s1;
                if ((n-= 1) == 0) {
                    s1%= BASE;
                    s2%= BASE;
                    n = NMAX;
                }
            }
        }
        s1%= BASE;
        s2%= BASE;
        write(this.buffer, this.idat_offs + this.idat_size - 8, byte4((s2 << 16) | s1));

        // compute crc32 of the PNG chunks
        function crc32(png, offs, size) {
            var crc = -1;
            for (var i = 4; i < size-4; i += 1) {
                crc = _crc32[(crc ^ png[offs+i]) & 0xff] ^ ((crc >> 8) & 0x00ffffff);
            }
            write(png, offs+size-4, byte4(crc ^ -1));
        }

        crc32(this.buffer, this.ihdr_offs, this.ihdr_size);
        crc32(this.buffer, this.plte_offs, this.plte_size);
        crc32(this.buffer, this.trns_offs, this.trns_size);
        crc32(this.buffer, this.idat_offs, this.idat_size);
        crc32(this.buffer, this.iend_offs, this.iend_size);

        // Allocate a new buffer to return
        var rbuf = new Uint8Array(MAGIC_STR.length + this.buffer.length);
        // Add the magic string at the start of the buffer
        rbuf.set(MAGIC_STR, 0);
        // Then add the working buffer to the return buffer after the magic string
        rbuf.set(this.buffer, MAGIC_STR.length);
        return rbuf;
    }
});

