# Country data: what each country really has

Written by `node scripts/country-report.mjs` from `data/countries/` (data of 2026-11-14).
A service is an organisation Wikidata files under that country, with an official
website, not closed, ranked by how many Wikipedia editions cover it. Tasks and Crew
jobs are what the page builds from those services, counted with the page's own
tables. Nothing is padded: a country with few entries on Wikidata shows few.

- Countries: **104**. Services: **100877**. Tasks: **289456**. Crew jobs, added up country by country: **1430130**.
- Distinct Crew jobs across all countries - what "See all jobs" holds, a service listed in several countries counted once: **1009008**.
- 500 or more services (Integrations): **102** countries. 200 or more: **104**. Under 200: **0**.
- 500 or more tasks: **104** countries. 500 or more Crew jobs: **104** countries.

| Country | Services | Tasks | Crew jobs | Kinds |
|---|---:|---:|---:|---:|
| United States (US) | 1732 | 5000 | 22926 | 43 |
| United Kingdom (GB) | 1682 | 4834 | 22065 | 44 |
| Germany (DE) | 1681 | 4834 | 22032 | 44 |
| Canada (CA) | 1608 | 4474 | 21461 | 44 |
| Spain (ES) | 1586 | 4548 | 21396 | 44 |
| France (FR) | 1573 | 4446 | 21031 | 44 |
| Netherlands (NL) | 1559 | 4287 | 20373 | 44 |
| Italy (IT) | 1538 | 4379 | 20666 | 44 |
| Australia (AU) | 1511 | 4210 | 19844 | 44 |
| Switzerland (CH) | 1505 | 4284 | 20569 | 43 |
| Japan (JP) | 1498 | 4259 | 19914 | 44 |
| Russia (RU) | 1437 | 4168 | 19924 | 43 |
| China (CN) | 1405 | 4101 | 19578 | 43 |
| Norway (NO) | 1388 | 3963 | 19096 | 43 |
| Sweden (SE) | 1383 | 3881 | 19109 | 42 |
| Austria (AT) | 1380 | 3949 | 18865 | 43 |
| Mexico (MX) | 1370 | 3941 | 19586 | 43 |
| Belgium (BE) | 1357 | 3758 | 18731 | 42 |
| India (IN) | 1326 | 3873 | 18727 | 42 |
| Ukraine (UA) | 1307 | 3811 | 18553 | 43 |
| Ireland (IE) | 1306 | 3634 | 18293 | 42 |
| Brazil (BR) | 1295 | 3761 | 17921 | 43 |
| Türkiye (TR) | 1288 | 3801 | 18314 | 41 |
| New Zealand (NZ) | 1285 | 3583 | 17793 | 42 |
| Israel (IL) | 1282 | 3530 | 17934 | 42 |
| Nigeria (NG) | 1276 | 3882 | 18758 | 40 |
| Poland (PL) | 1264 | 3485 | 15420 | 41 |
| South Korea (KR) | 1256 | 3779 | 18323 | 43 |
| Czechia (CZ) | 1245 | 3525 | 17376 | 42 |
| Finland (FI) | 1213 | 3330 | 17116 | 42 |
| Portugal (PT) | 1210 | 3406 | 17389 | 40 |
| Indonesia (ID) | 1196 | 3569 | 16919 | 41 |
| Argentina (AR) | 1177 | 3440 | 17264 | 43 |
| Taiwan (TW) | 1169 | 3458 | 16769 | 41 |
| South Africa (ZA) | 1157 | 3331 | 17074 | 43 |
| Singapore (SG) | 1100 | 3157 | 16166 | 41 |
| Romania (RO) | 1037 | 2861 | 13841 | 41 |
| Malaysia (MY) | 1035 | 2990 | 15741 | 38 |
| Philippines (PH) | 1029 | 3113 | 15462 | 41 |
| Ghana (GH) | 1018 | 3068 | 14579 | 37 |
| Denmark (DK) | 1006 | 2872 | 14463 | 41 |
| Egypt (EG) | 993 | 2928 | 14612 | 37 |
| United Arab Emirates (AE) | 978 | 2954 | 14954 | 36 |
| Greece (GR) | 975 | 2572 | 12691 | 41 |
| Saudi Arabia (SA) | 939 | 2836 | 14605 | 36 |
| Thailand (TH) | 931 | 2821 | 14372 | 39 |
| Chile (CL) | 927 | 2493 | 12390 | 40 |
| Colombia (CO) | 910 | 2526 | 12228 | 40 |
| Uganda (UG) | 909 | 2714 | 13924 | 40 |
| Hungary (HU) | 904 | 2404 | 12065 | 42 |
| Pakistan (PK) | 897 | 2797 | 13962 | 37 |
| Morocco (MA) | 880 | 2561 | 13594 | 39 |
| Bangladesh (BD) | 870 | 2661 | 12919 | 37 |
| Bulgaria (BG) | 861 | 2349 | 11789 | 41 |
| Peru (PE) | 857 | 2395 | 11885 | 41 |
| Kenya (KE) | 846 | 2574 | 12523 | 36 |
| Vietnam (VN) | 835 | 2638 | 13134 | 41 |
| Croatia (HR) | 828 | 2219 | 11004 | 40 |
| Hong Kong (HK) | 827 | 2312 | 11024 | 38 |
| Georgia (GE) | 822 | 2406 | 12104 | 39 |
| Estonia (EE) | 815 | 2180 | 10618 | 40 |
| Tunisia (TN) | 809 | 2348 | 11516 | 37 |
| Armenia (AM) | 796 | 2291 | 11520 | 40 |
| Serbia (RS) | 794 | 2188 | 10999 | 39 |
| Slovakia (SK) | 794 | 2117 | 10509 | 41 |
| Rwanda (RW) | 771 | 2280 | 11271 | 33 |
| Kazakhstan (KZ) | 765 | 2263 | 11576 | 38 |
| Azerbaijan (AZ) | 759 | 2216 | 11530 | 35 |
| Sri Lanka (LK) | 758 | 2308 | 11800 | 37 |
| Algeria (DZ) | 756 | 2225 | 11787 | 34 |
| Lithuania (LT) | 734 | 1971 | 10056 | 41 |
| Latvia (LV) | 733 | 1980 | 10258 | 40 |
| Namibia (NA) | 726 | 1995 | 10288 | 37 |
| Slovenia (SI) | 724 | 1870 | 9762 | 39 |
| Lebanon (LB) | 722 | 2103 | 10572 | 33 |
| Cameroon (CM) | 719 | 2075 | 10554 | 34 |
| Zimbabwe (ZW) | 719 | 2089 | 10408 | 36 |
| Venezuela (VE) | 715 | 2070 | 10487 | 36 |
| Botswana (BW) | 705 | 2020 | 10141 | 33 |
| Senegal (SN) | 701 | 2032 | 10190 | 34 |
| Nepal (NP) | 691 | 2080 | 10023 | 36 |
| Ethiopia (ET) | 677 | 2057 | 10085 | 33 |
| Ecuador (EC) | 669 | 1901 | 9589 | 36 |
| Tanzania (TZ) | 667 | 2002 | 9830 | 37 |
| Uruguay (UY) | 666 | 1728 | 8958 | 39 |
| Uzbekistan (UZ) | 665 | 2024 | 10203 | 38 |
| Qatar (QA) | 645 | 1914 | 10102 | 34 |
| Jordan (JO) | 618 | 1812 | 9437 | 35 |
| Panama (PA) | 613 | 1711 | 8758 | 36 |
| Zambia (ZM) | 608 | 1774 | 8993 | 35 |
| Costa Rica (CR) | 601 | 1659 | 8513 | 40 |
| Kuwait (KW) | 594 | 1708 | 8920 | 33 |
| Dominican Republic (DO) | 583 | 1659 | 8541 | 35 |
| Iraq (IQ) | 583 | 1767 | 8712 | 36 |
| Bahrain (BH) | 581 | 1691 | 8802 | 35 |
| Mozambique (MZ) | 575 | 1625 | 8422 | 32 |
| Angola (AO) | 574 | 1701 | 8792 | 30 |
| Bolivia (BO) | 573 | 1595 | 8298 | 34 |
| Mongolia (MN) | 553 | 1580 | 8272 | 35 |
| Oman (OM) | 530 | 1513 | 8139 | 34 |
| Paraguay (PY) | 510 | 1424 | 7576 | 32 |
| Guatemala (GT) | 507 | 1429 | 7594 | 35 |
| Cambodia (KH) | 493 | 1441 | 7678 | 34 |
| Myanmar (MM) | 427 | 1305 | 6911 | 28 |
