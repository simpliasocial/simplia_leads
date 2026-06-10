import assert from "node:assert/strict";
import createJiti from "jiti";

const jiti = createJiti(import.meta.url);
const { buildPaginatedListState } = jiti("../../src/lib/windowedList.ts");

const test = (name, fn) => {
    try {
        fn();
        console.log(`ok - ${name}`);
    } catch (error) {
        console.error(`not ok - ${name}`);
        console.error(error);
        process.exitCode = 1;
    }
};

const rows = Array.from({ length: 45 }, (_, index) => index + 1);

test("pagination returns rows 1 through 20 on the first page", () => {
    const state = buildPaginatedListState(rows, 1);
    assert.deepEqual(state.visibleItems, rows.slice(0, 20));
    assert.equal(state.start, 1);
    assert.equal(state.end, 20);
    assert.equal(state.pageCount, 3);
});

test("pagination returns rows 21 through 40 on the second page", () => {
    const state = buildPaginatedListState(rows, 2);
    assert.deepEqual(state.visibleItems, rows.slice(20, 40));
    assert.equal(state.start, 21);
    assert.equal(state.end, 40);
});

test("pagination clamps invalid pages and preserves the final partial page", () => {
    const state = buildPaginatedListState(rows, 99);
    assert.equal(state.page, 3);
    assert.deepEqual(state.visibleItems, rows.slice(40));
    assert.equal(state.start, 41);
    assert.equal(state.end, 45);
});
