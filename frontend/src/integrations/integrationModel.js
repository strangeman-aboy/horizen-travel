import { extractShareUrl } from "../api/travelMappers.js";

export function readDroppedShareText(dataTransfer) {
  if (!dataTransfer || typeof dataTransfer.getData !== "function") {
    return { value: "", shareUrl: null };
  }

  const uriList = String(dataTransfer.getData("text/uri-list") ?? "").trim();
  const plainText = String(dataTransfer.getData("text/plain") ?? "").trim();
  const value = uriList || plainText;

  return {
    value,
    shareUrl: extractShareUrl(value) || null,
  };
}

export function normalizeIntegrationIdentifier(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function findPlaceForBookingOption(option, places = []) {
  if (!option || !Array.isArray(places)) return null;

  const clientStopId = normalizeIntegrationIdentifier(option.clientStopId);
  if (clientStopId) {
    const exactClientStopMatch = places.find((place) => (
      normalizeIntegrationIdentifier(place?.clientStopId) === clientStopId
    ));
    if (exactClientStopMatch) return exactClientStopMatch;

    const currentFrontendIdMatch = places.find((place) => (
      normalizeIntegrationIdentifier(place?.id) === clientStopId
    ));
    if (currentFrontendIdMatch) return currentFrontendIdMatch;
  }

  const optionPlaceId = normalizeIntegrationIdentifier(
    option.placeId ?? option.internalPlaceId,
  );
  if (!optionPlaceId) return null;

  return places.find((place) => (
    [
      place?.placeId,
      place?.internalPlaceId,
      place?.sourceStopId,
    ].some((candidate) => (
      normalizeIntegrationIdentifier(candidate) === optionPlaceId
    ))
  )) ?? null;
}

export function linkBookingOptionsToPlaces(options = [], places = []) {
  if (!Array.isArray(options)) return [];
  return options.map((option) => ({
    option,
    place: findPlaceForBookingOption(option, places),
  }));
}

export function selectBookingOptionsForStop(linkedOptions = [], activeStopId = null) {
  if (!Array.isArray(linkedOptions)) return [];
  const activeIdentifier = normalizeIntegrationIdentifier(activeStopId);
  if (!activeIdentifier) return linkedOptions;

  const matching = linkedOptions.filter(({ option, place }) => (
    [
      option?.clientStopId,
      place?.clientStopId,
      place?.id,
    ].some((candidate) => (
      normalizeIntegrationIdentifier(candidate) === activeIdentifier
    ))
  ));

  // The dashboard can briefly retain a previous visual selection while a new
  // trip is hydrating. Showing all valid options is safer than an empty panel.
  return matching.length ? matching : linkedOptions;
}

export function normalizeMockBookingReceipt(payload, option = null) {
  const raw = payload?.data ?? payload?.result ?? payload ?? {};
  return {
    redirectId: normalizeIntegrationIdentifier(raw.redirectId) || null,
    bookingOptionId: normalizeIntegrationIdentifier(
      raw.bookingOptionId ?? option?.bookingOptionId,
    ) || null,
    status: normalizeIntegrationIdentifier(raw.status) || "MOCK_PLACEHOLDER",
    receiptStatus: normalizeIntegrationIdentifier(raw.receiptStatus) || "MOCK_RECORDED",
    createdAt: raw.createdAt ?? new Date().toISOString(),
    message: raw.message
      ?? "演示意向已记录；没有跳转到美团，也没有创建订单或支付。",
    redirectUrl: raw.redirectUrl ?? null,
  };
}
