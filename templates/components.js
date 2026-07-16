"use strict";
const { esc } = require("./layout");

// genre → schema.org @type
const SCHEMA_TYPE = {
  "そば": "Restaurant", "洋食": "Restaurant", "食堂": "Restaurant",
  "中華": "Restaurant", "焼肉": "Restaurant", "ステーキ": "Restaurant",
  "天ぷら・うどん": "Restaurant", "居酒屋": "Restaurant", "唐揚げ持ち帰り": "Restaurant",
  "パン": "Bakery",
  "カフェ": "CafeOrCoffeeShop", "喫茶店": "CafeOrCoffeeShop",
  "スーパー": "GroceryStore",
  "コンビニ": "ConvenienceStore",
  "駄菓子": "Store", "青果": "Store", "ドラッグストア": "Store",
  "理髪店": "HairSalon",
  "クリーニング": "DryCleaningOrLaundry",
  "ガソリンスタンド": "GasStation",
  "金融": "BankOrCreditUnion",
  "寺院": "BuddhistTemple",
  "フィットネス": "ExerciseGym",
  "写真スタジオ": "LocalBusiness", "新聞販売店": "LocalBusiness", "住宅設備": "LocalBusiness",
  "歯科": "Dentist",
  "薬局": "Pharmacy",
  "診療所": "MedicalClinic", "医院": "MedicalClinic", "クリニック": "MedicalClinic",
  "整骨院": "MedicalBusiness",
};

// 一般店舗のグルーピング（shops.html）
const EAT = ["そば","洋食","食堂","中華","焼肉","ステーキ","天ぷら・うどん","居酒屋","唐揚げ持ち帰り","パン","カフェ","喫茶店"];
const BUY = ["スーパー","コンビニ","駄菓子","青果","ドラッグストア"];
function shopGroup(genre) {
  if (EAT.includes(genre)) return "eat";
  if (BUY.includes(genre)) return "buy";
  return "service";
}

// 医療のグルーピング（medical.html）
function medicalGroup(genre) {
  return genre === "薬局" ? "pharmacy" : "clinic";
}

function schemaType(genre) {
  return SCHEMA_TYPE[genre] || "LocalBusiness";
}

// "03-3612-4973" → "+81-3-3612-4973" / "080-..." → "+81-80-..."
function tel81(tel) {
  if (!tel) return null;
  const digits = tel.replace(/[^\d]/g, "");
  if (!digits.startsWith("0")) return "+81-" + tel;
  const rest = tel.replace(/^0/, "");
  return "+81-" + rest;
}

function telLink(tel) {
  if (!tel) return "";
  return `<a class="tel" href="tel:${tel.replace(/[^\d+]/g, "")}">${esc(tel)}</a>`;
}

// 1店舗カード（HTML）
function shopCard(s) {
  const rows = [];
  rows.push(`<p class="meta"><span class="k">住所</span><span>${esc(s.address)}</span></p>`);
  if (s.tel) rows.push(`<p class="meta"><span class="k">電話</span>${telLink(s.tel)}</p>`);
  const isMed = s.category === "medical";
  const hoursLabel = isMed ? "診療時間" : "営業時間";
  const closedLabel = isMed ? "休診日" : "定休日";
  if (s.openingHours) rows.push(`<p class="meta"><span class="k">${hoursLabel}</span><span>${esc(s.openingHours)}</span></p>`);
  if (s.closedDays) rows.push(`<p class="meta"><span class="k">${closedLabel}</span><span>${esc(s.closedDays)}</span></p>`);
  if (s.payment) rows.push(`<p class="meta"><span class="k">支払い</span><span>${esc(s.payment)}</span></p>`);
  if (s.description) rows.push(`<p class="meta"><span>${esc(s.description)}</span></p>`);
  if (s.url) rows.push(`<p class="meta"><a href="${esc(s.url)}" target="_blank" rel="noopener">公式サイト</a></p>`);
  const formal = s.formalName ? `\n  <p class="formal-name">${esc(s.formalName)}</p>` : "";
  return `<article class="card" id="${esc(s.id)}">
  <span class="genre">${esc(s.genre)}</span>
  <h3>${esc(s.name)}</h3>${formal}
  ${rows.join("\n  ")}
</article>`;
}

// 1店舗の JSON-LD
function shopJsonLd(s, site) {
  const obj = {
    "@context": "https://schema.org",
    "@type": schemaType(s.genre),
    name: s.name,
    address: {
      "@type": "PostalAddress",
      streetAddress: s.address.replace(/^東京都墨田区/, ""),
      addressLocality: "墨田区",
      addressRegion: "東京都",
      addressCountry: "JP",
    },
  };
  const t = tel81(s.tel);
  if (t) obj.telephone = t;
  if (s.formalName) obj.legalName = s.formalName;
  if (s.url) obj.url = s.url;
  if (Array.isArray(s.openingHoursSpec) && s.openingHoursSpec.length) {
    obj.openingHoursSpecification = s.openingHoursSpec.map((spec) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: (spec.days || []).map((d) => DAY_FULL[d] || d),
      opens: spec.opens,
      closes: spec.closes,
    }));
  }
  return obj;
}

// schema.org dayOfWeek 用の曜日名変換
const DAY_FULL = { Mo: "Monday", Tu: "Tuesday", We: "Wednesday", Th: "Thursday", Fr: "Friday", Sa: "Saturday", Su: "Sunday" };

// イベントカード
function eventCard(e) {
  const label = e.status === "upcoming" ? "開催予定" : e.status === "ongoing" ? "開催中" : "終了";
  const when = e.dateStart === e.dateEnd ? fmtDate(e.dateStart) : `${fmtDate(e.dateStart)}〜${fmtDate(e.dateEnd)}`;
  const timeLine = e.timeNote ? `\n  <p class="when time">${esc(e.timeNote)}</p>` : "";
  const flyer = e.image
    ? `\n  <a class="event-flyer" href="assets/events/${esc(e.image)}" target="_blank" rel="noopener" title="チラシを原寸で開く"><img src="assets/events/${esc(e.image)}" width="1200" height="1683" loading="lazy" alt="${esc(e.title)}のチラシ"></a>`
    : "";
  return `<article class="event" id="${esc(e.id)}">
  <span class="badge ${esc(e.status)}">${label}</span>
  <h3>${esc(e.title)}</h3>
  <p class="when">${esc(when)}</p>${timeLine}
  <p class="where">会場：${esc(e.venue)}</p>
  <p>${esc(e.body || e.summary)}</p>${flyer}
</article>`;
}

function eventJsonLd(e, site) {
  const statusMap = {
    upcoming: "https://schema.org/EventScheduled",
    ongoing: "https://schema.org/EventScheduled",
    past: "https://schema.org/EventScheduled",
  };
  const obj = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: e.title,
    startDate: e.startDateTime || e.dateStart,
    endDate: e.endDateTime || e.dateEnd,
    eventStatus: statusMap[e.status],
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: {
      "@type": "Place",
      name: e.venue,
      address: {
        "@type": "PostalAddress",
        addressLocality: "墨田区",
        addressRegion: "東京都",
        addressCountry: "JP",
      },
    },
    description: e.summary,
    organizer: { "@type": "Organization", name: site.name },
  };
  if (e.image) obj.image = `https://www.azuma-terrace.com/assets/events/${e.image}`;
  return obj;
}

// サイト全体の ShoppingCenter（全ページ共通）
function shoppingCenterJsonLd(site) {
  return {
    "@context": "https://schema.org",
    "@type": "ShoppingCenter",
    name: site.alternateName,
    alternateName: site.name,
    description: `${site.vision}／最寄駅：${site.access}`,
    address: {
      "@type": "PostalAddress",
      postalCode: site.postalCode,
      streetAddress: site.streetAddress,
      addressLocality: site.addressLocality,
      addressRegion: site.addressRegion,
      addressCountry: "JP",
    },
    email: site.email,
    sameAs: [site.lineUrl],
  };
}

function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

module.exports = {
  schemaType, shopGroup, medicalGroup, tel81, telLink,
  shopCard, shopJsonLd, eventCard, eventJsonLd, shoppingCenterJsonLd, fmtDate,
};
