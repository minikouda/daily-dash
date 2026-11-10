"""Package records: normalize what Claude extracted and merge status updates.

Tracking numbers are checked with the `tracking-numbers` library (carrier
patterns + checksums from jkeen/tracking_number_data). A number it recognizes
gets the library's carrier and tracking URL; otherwise we keep Claude's
carrier guess and fall back to a generic carrier URL.
"""

import re

import tracking_numbers

STATUS_ORDER = ["ordered", "shipped", "in_transit", "out_for_delivery", "delivered"]
STATUS_LABELS = {
    "ordered": "Ordered",
    "shipped": "Shipped",
    "in_transit": "In transit",
    "out_for_delivery": "Out for delivery",
    "delivered": "Delivered",
    "exception": "Needs attention",
}

CARRIER_URLS = {
    "ups": "https://www.ups.com/track?tracknum={n}",
    "usps": "https://tools.usps.com/go/TrackConfirmAction?tLabels={n}",
    "fedex": "https://www.fedex.com/fedextrack/?trknbr={n}",
    "dhl": "https://www.dhl.com/us-en/home/tracking/tracking-express.html?tracking-id={n}",
    "ontrac": "https://www.ontrac.com/tracking/?number={n}",
    "lasership": "https://www.ontrac.com/tracking/?number={n}",
}
CARRIER_NAMES = {
    "ups": "UPS", "usps": "USPS", "fedex": "FedEx", "dhl": "DHL", "amazon": "Amazon",
    "ontrac": "OnTrac", "lasership": "LaserShip",
}


def normalize_number(raw: str | None) -> str | None:
    if not raw:
        return None
    n = re.sub(r"[\s-]", "", raw).upper()
    return n if len(n) >= 8 else None


def identify(number: str) -> tuple[str | None, str | None]:
    """(carrier code, tracking url) from the library, or (None, None)."""
    tn = tracking_numbers.get_tracking_number(number)
    if tn is None or not tn.valid:
        return None, None
    return tn.courier.code, tn.tracking_url


def carrier_url(number: str, carrier: str | None, lib_url: str | None = None) -> str | None:
    """Official tracking page for a number, or None if the carrier has no public page (e.g. Amazon)."""
    if carrier in CARRIER_URLS:
        return CARRIER_URLS[carrier].format(n=number)
    return lib_url


def carrier_name(code: str | None) -> str:
    if not code:
        return ""
    return CARRIER_NAMES.get(code, code.upper() if len(code) <= 4 else code.title())


def package_key(pkg: dict) -> str | None:
    if pkg.get("tracking_number"):
        return pkg["tracking_number"]
    if pkg.get("order_number"):
        merchant = re.sub(r"\W+", "", (pkg.get("merchant") or "").lower())
        return f"order:{merchant}:{pkg['order_number']}"
    return None


def normalize(pkg: dict) -> dict | None:
    """Clean one extracted package; None if there's nothing to key it on."""
    out = dict(pkg)
    number = normalize_number(pkg.get("tracking_number"))
    out["tracking_number"] = number
    carrier = (pkg.get("carrier") or "").lower() or None
    url = pkg.get("tracking_url")
    if number:
        lib_carrier, lib_url = identify(number)
        carrier = lib_carrier or carrier
        # The carrier's own page beats whatever the email linked: retailer emails
        # often wrap tracking in click-tracking redirects that expire or break.
        url = carrier_url(number, carrier, lib_url) or url
    out["carrier"] = carrier
    out["tracking_url"] = url
    out["key"] = package_key(out)
    return out if out["key"] else None


def merged_status(old: str, new: str, old_time: str, new_time: str) -> str:
    """Later email wins; an out-of-order older email can't move status backwards."""
    if new_time >= old_time:
        return new
    if old in STATUS_ORDER and new in STATUS_ORDER and STATUS_ORDER.index(new) > STATUS_ORDER.index(old):
        return new
    return old


def upsert(conn, pkg: dict, received_at: str, account: str) -> None:
    row = conn.execute("SELECT * FROM packages WHERE key = ?", (pkg["key"],)).fetchone()
    # An order-number record may already exist for a shipment we now have a
    # tracking number for: fold it into the tracking-number record.
    if row is None and pkg.get("tracking_number") and pkg.get("order_number"):
        merchant = re.sub(r"\W+", "", (pkg.get("merchant") or "").lower())
        old_key = f"order:{merchant}:{pkg['order_number']}"
        row = conn.execute("SELECT * FROM packages WHERE key = ?", (old_key,)).fetchone()
        if row is not None:
            conn.execute("UPDATE packages SET key = ?, tracking_number = ? WHERE key = ?",
                         (pkg["key"], pkg["tracking_number"], old_key))
            row = conn.execute("SELECT * FROM packages WHERE key = ?", (pkg["key"],)).fetchone()

    delivered_at = received_at if pkg["status"] == "delivered" else None
    if row is None:
        conn.execute(
            "INSERT INTO packages (key, tracking_number, order_number, carrier, merchant, description,"
            " status, eta, tracking_url, last_update, source_msg_id, account, delivered_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (pkg["key"], pkg.get("tracking_number"), pkg.get("order_number"), pkg.get("carrier"),
             pkg.get("merchant"), pkg.get("description"), pkg["status"], pkg.get("eta"),
             pkg.get("tracking_url"), received_at, pkg.get("source_message_id"), account, delivered_at),
        )
        return

    status = merged_status(row["status"], pkg["status"], row["last_update"], received_at)
    newer = received_at >= row["last_update"]
    conn.execute(
        "UPDATE packages SET status = ?, eta = ?, last_update = ?, carrier = ?, order_number = ?,"
        " merchant = ?, description = ?, tracking_url = ?, source_msg_id = ?, delivered_at = ?,"
        " archived = CASE WHEN ? = 'delivered' THEN archived ELSE 0 END WHERE key = ?",
        (
            status,
            (pkg.get("eta") if newer else None) or row["eta"],
            max(received_at, row["last_update"]),
            row["carrier"] or pkg.get("carrier"),
            row["order_number"] or pkg.get("order_number"),
            row["merchant"] or pkg.get("merchant"),
            row["description"] or pkg.get("description"),
            pkg.get("tracking_url") or row["tracking_url"],
            pkg.get("source_message_id") if newer else row["source_msg_id"],
            row["delivered_at"] or (delivered_at if status == "delivered" else None),
            status,
            pkg["key"],
        ),
    )
