import assert from "node:assert/strict";
import createJiti from "jiti";

const jiti = createJiti(import.meta.url);
const {
    buildDynamicQuestions,
    canFinalizeBaseContext,
    validateInternalBusinessData,
} = jiti("../../src/features/onboarding-bre/model/onboardingBreModel.ts");

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

const field = (overrides = {}) => ({
    key: "industry",
    category: "classification",
    value: "Tecnología",
    origin: "extracted",
    confidence: "high",
    status: "extracted",
    evidence: [],
    ...overrides,
});

const validInternal = {
    averageTicket: { currency: "USD", mode: "single", value: 100 },
    ltv: { currency: "USD", mode: "range", min: 500, max: 1000 },
    cac: { currency: "USD", mode: "single", value: 25 },
    businessModels: ["Suscripción"],
};

test("high-confidence extracted values do not create confirmation questions", () => {
    assert.equal(buildDynamicQuestions([field()]).length, 0);
});

test("inferred values always require confirmation even with high confidence", () => {
    const questions = buildDynamicQuestions([field({ origin: "inferred", status: "inferred" })]);
    assert.equal(questions.length, 1);
    assert.equal(questions[0].reason, "confirmation");
});

test("questions are only generated for the eleven permitted context fields", () => {
    const questions = buildDynamicQuestions([
        field({ key: "mission", status: "not_found", value: null }),
        field({ key: "commercial_name", status: "not_found", value: null }),
    ]);
    assert.deepEqual(questions.map((question) => question.fieldKey), ["commercial_name"]);
});

test("contradictions generate a resolution question and keep alternatives", () => {
    const alternatives = [{ value: "Ecuador" }, { value: "Colombia" }];
    const [question] = buildDynamicQuestions([
        field({ key: "country", contradiction: true, alternatives }),
    ]);
    assert.equal(question.reason, "contradiction");
    assert.deepEqual(question.alternatives, alternatives);
});

test("all internal metrics and a business model are mandatory", () => {
    const errors = validateInternalBusinessData({
        ...validInternal,
        cac: { currency: "USD", mode: "single", value: 0 },
        businessModels: [],
    });
    assert.ok(errors.cac);
    assert.ok(errors.businessModels);
});

test("base context only finalizes with resolved questions and valid internal data", () => {
    assert.equal(canFinalizeBaseContext([field()], validInternal), true);
    assert.equal(canFinalizeBaseContext([field({ origin: "inferred", status: "inferred" })], validInternal), false);
});
