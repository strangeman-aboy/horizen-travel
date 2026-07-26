import test from "node:test";
import assert from "node:assert/strict";
import {
  findPlaceForBookingOption,
  linkBookingOptionsToPlaces,
  normalizeMockBookingReceipt,
  readDroppedShareText,
  selectBookingOptionsForStop,
} from "../src/integrations/integrationModel.js";

function createDataTransfer(values) {
  return {
    getData(type) {
      return values[type] ?? "";
    },
  };
}

test("readDroppedShareText prefers URI lists and extracts an official share URL", () => {
  const result = readDroppedShareText(createDataTransfer({
    "text/uri-list": "# browser source\nhttps://www.xiaohongshu.com/explore/demo-note?xsec_token=abc\n",
    "text/plain": "https://example.com/not-used",
  }));

  assert.match(result.value, /xiaohongshu/u);
  assert.equal(
    result.shareUrl,
    "https://www.xiaohongshu.com/explore/demo-note?xsec_token=abc",
  );
});

test("readDroppedShareText falls back to plain text without accepting unrelated hosts", () => {
  const result = readDroppedShareText(createDataTransfer({
    "text/plain": "look at https://example.com/a-note",
  }));

  assert.equal(result.value, "look at https://example.com/a-note");
  assert.equal(result.shareUrl, null);
});

test("findPlaceForBookingOption prioritizes exact clientStopId linkage", () => {
  const places = [
    { id: 1, clientStopId: "other", name: "错误地点" },
    { id: 2, clientStopId: "stop-2", name: "五道营胡同" },
  ];

  assert.equal(
    findPlaceForBookingOption({ clientStopId: "stop-2" }, places)?.name,
    "五道营胡同",
  );
});

test("booking options link to frontend ids and filter around the active stop", () => {
  const places = [
    { id: 1, name: "雍和宫" },
    { id: 2, name: "五道营胡同" },
  ];
  const options = [
    { bookingOptionId: "a", clientStopId: "1" },
    { bookingOptionId: "b", clientStopId: "2" },
  ];
  const linked = linkBookingOptionsToPlaces(options, places);

  assert.deepEqual(linked.map(({ place }) => place?.name), ["雍和宫", "五道营胡同"]);
  assert.deepEqual(
    selectBookingOptionsForStop(linked, 2).map(({ option }) => option.bookingOptionId),
    ["b"],
  );
});

test("active-stop selection safely falls back to all valid options during hydration", () => {
  const linked = linkBookingOptionsToPlaces(
    [{ bookingOptionId: "a", clientStopId: "1" }],
    [{ id: 1, name: "雍和宫" }],
  );

  assert.equal(selectBookingOptionsForStop(linked, "stale-dashboard-id").length, 1);
});

test("normalizeMockBookingReceipt never implies a payment redirect", () => {
  const receipt = normalizeMockBookingReceipt({
    redirectId: "booking-redirect-demo",
    bookingOptionId: "option-1",
    status: "MOCK_PLACEHOLDER",
    receiptStatus: "MOCK_RECORDED",
    redirectUrl: null,
    message: "已记录模拟跳转意向。",
  });

  assert.equal(receipt.redirectId, "booking-redirect-demo");
  assert.equal(receipt.receiptStatus, "MOCK_RECORDED");
  assert.equal(receipt.redirectUrl, null);
  assert.match(receipt.message, /模拟/u);
});
