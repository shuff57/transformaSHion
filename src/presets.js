/* Example setups for Tracing Paper. Coordinates are the worked cases from Integrated Math 1 section 3.1 (Moving Figures in the Plane),
 * each recomputed by projects/Integrated Math 1/_tools/verify_3_1.py in the book repo. Edit freely: a preset is plain data. */
(function (root) {
  var KITE = [[14, 18], [8, 12], [11, 4], [13, 8], [14, 2], [15, 8], [17, 4], [20, 12]];
  root.TRACING_PAPER_PRESETS = [
    { id: "blank", title: "Blank grid", note: "Lay the paper down, mark your own points, and try a slide, a turn or a flip.", xr: [-10, 10], yr: [-8, 8] },
    {
      id: "triangle-mirror", title: "A triangle and a mirror", xr: [0, 10], yr: [0, 7],
      note: "Predict where the triangle lands when it flips over the mirror line x = 5. Then fold the paper to test it.",
      shapes: [{ name: "triangle", pts: [[1, 2], [4, 2], [1, 6]] }], guides: [{ type: "v", a: 5 }],
      checks: [{ label: "Flip over x = 5", answer: [[9, 2], [6, 2], [9, 6]] }],
    },
    {
      id: "axes", title: "Flips over the axes and y = x", xr: [-8, 8], yr: [-6, 7],
      note: "One triangle, three mirrors. What does each flip do to the coordinates?",
      shapes: [{ name: "triangle", pts: [[2, 1], [6, 1], [2, 4]] }], guides: [{ type: "v", a: 0 }, { type: "h", b: 0 }, { type: "diag" }],
      checks: [
        { label: "Flip over the y-axis", answer: [[-2, 1], [-6, 1], [-2, 4]] },
        { label: "Flip over the x-axis", answer: [[2, -1], [6, -1], [2, -4]] },
        { label: "Flip over y = x", answer: [[1, 2], [1, 6], [4, 2]] },
      ],
    },
    {
      id: "parallel", title: "Two flips, parallel mirrors", xr: [-3, 11], yr: [0, 7],
      note: "Flip over the first mirror, then the second. What single move would do the same job, and how far is it?",
      shapes: [{ name: "triangle", pts: [[-1, 1], [-1, 4], [1, 1]] }], guides: [{ type: "v", a: 2 }, { type: "v", a: 6 }],
      checks: [{ label: "After flipping over x = 2, then x = 6", answer: [[7, 1], [7, 4], [9, 1]] }],
    },
    {
      id: "crossing", title: "Two flips, mirrors that cross", xr: [-7, 7], yr: [-5, 7],
      note: "The order of the two flips matters. Try both orders and compare.",
      shapes: [{ name: "triangle", pts: [[2, 1], [6, 1], [2, 4]] }], guides: [{ type: "h", b: 0 }, { type: "v", a: 0 }, { type: "diag" }],
      checks: [
        { label: "x-axis, then y-axis", answer: [[-2, -1], [-6, -1], [-2, -4]] },
        { label: "x-axis, then y = x", answer: [[-1, 2], [-1, 6], [-4, 2]] },
        { label: "y = x, then x-axis", answer: [[1, -2], [1, -6], [4, -2]] },
      ],
    },
    {
      id: "turn", title: "A turn about a point that is not the origin", xr: [-1, 9], yr: [-2, 8], center: [4, 2],
      note: "Turn the triangle a quarter turn counterclockwise about (4, 2). Swapping coordinates is not enough here.",
      shapes: [{ name: "triangle", pts: [[7, 2], [4, 6], [1, 4]] }],
      checks: [{ label: "Quarter turn counterclockwise about (4, 2)", answer: [[4, 5], [0, 2], [2, -1]] }],
    },
    {
      id: "kite", title: "The kite", xr: [0, 40], yr: [0, 22], center: [14, 10],
      note: "Eight anchor points are enough to move the whole kite. Try a slide of 10 right and 2 up, a quarter turn about (14, 10), or a flip over x = 22.",
      shapes: [{ name: "kite", pts: KITE }], guides: [{ type: "v", a: 22 }],
    },
  ];
})(typeof self !== "undefined" ? self : this);
