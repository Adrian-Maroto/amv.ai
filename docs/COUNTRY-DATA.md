# Country data: what each country really has

Written by `node scripts/country-report.mjs` from `data/countries/` (data of 2026-11-25).
A service is an organisation Wikidata files under that country, with an official
website, not closed, ranked by how many Wikipedia editions cover it. Tasks and Crew
jobs are what the page builds from those services, counted with the page's own
tables. Nothing is padded: a country with few entries on Wikidata shows few.

- Countries: **104**. Services: **109393**. Tasks: **321222**. Crew jobs, added up country by country: **1688868**.
- Distinct Crew jobs across all countries - what "See all jobs" holds, a service listed in several countries counted once: **1024361**.
- 500 or more services (Integrations): **104** countries. 200 or more: **104**. Under 200: **0**.
- 500 or more tasks: **104** countries. 500 or more Crew jobs: **104** countries.

| Country | Services | Tasks | Crew jobs | Kinds |
|---|---:|---:|---:|---:|
| United Kingdom (GB) | 1808 | 5221 | 25407 | 45 |
| Germany (DE) | 1765 | 5092 | 24852 | 45 |
| Canada (CA) | 1696 | 4766 | 24122 | 45 |
| United States (US) | 1695 | 4857 | 22334 | 44 |
| Australia (AU) | 1639 | 4675 | 23540 | 45 |
| France (FR) | 1636 | 4641 | 23448 | 45 |
| Netherlands (NL) | 1624 | 4525 | 23103 | 45 |
| Italy (IT) | 1614 | 4618 | 23298 | 45 |
| Spain (ES) | 1604 | 4607 | 23226 | 45 |
| Japan (JP) | 1545 | 4441 | 21335 | 45 |
| Switzerland (CH) | 1497 | 4298 | 21970 | 44 |
| Belgium (BE) | 1436 | 4043 | 21499 | 43 |
| Sweden (SE) | 1433 | 4048 | 21294 | 43 |
| Austria (AT) | 1424 | 4065 | 21076 | 44 |
| Denmark (DK) | 1416 | 3982 | 21072 | 42 |
| Russia (RU) | 1407 | 4098 | 19542 | 44 |
| New Zealand (NZ) | 1381 | 3917 | 20537 | 43 |
| Ireland (IE) | 1354 | 3812 | 20705 | 43 |
| Mexico (MX) | 1323 | 3901 | 19743 | 44 |
| India (IN) | 1322 | 3934 | 19440 | 43 |
| Israel (IL) | 1319 | 3703 | 19609 | 43 |
| China (CN) | 1314 | 3909 | 18956 | 44 |
| Poland (PL) | 1307 | 3762 | 17560 | 42 |
| Norway (NO) | 1302 | 3742 | 18100 | 44 |
| Ukraine (UA) | 1290 | 3842 | 19042 | 44 |
| Brazil (BR) | 1286 | 3808 | 18599 | 44 |
| Finland (FI) | 1281 | 3570 | 19553 | 44 |
| Czechia (CZ) | 1262 | 3660 | 18286 | 43 |
| South Korea (KR) | 1253 | 3845 | 19113 | 44 |
| Nigeria (NG) | 1253 | 3909 | 19023 | 41 |
| Türkiye (TR) | 1225 | 3643 | 17338 | 42 |
| Singapore (SG) | 1200 | 3486 | 19102 | 42 |
| Argentina (AR) | 1182 | 3551 | 18113 | 44 |
| Portugal (PT) | 1137 | 3215 | 16530 | 41 |
| Indonesia (ID) | 1117 | 3357 | 15981 | 42 |
| Ghana (GH) | 1106 | 3401 | 17542 | 38 |
| Greece (GR) | 1105 | 3052 | 16414 | 42 |
| Romania (RO) | 1099 | 3181 | 16117 | 42 |
| South Africa (ZA) | 1080 | 3133 | 16032 | 44 |
| Taiwan (TW) | 1076 | 3218 | 15625 | 42 |
| United Arab Emirates (AE) | 1066 | 3222 | 17476 | 38 |
| Egypt (EG) | 1032 | 3153 | 16386 | 38 |
| Philippines (PH) | 1032 | 3186 | 16299 | 41 |
| Uganda (UG) | 1030 | 3084 | 17122 | 41 |
| Malaysia (MY) | 1022 | 3053 | 16395 | 39 |
| Morocco (MA) | 1021 | 3022 | 17214 | 40 |
| Estonia (EE) | 999 | 2787 | 15167 | 41 |
| Hungary (HU) | 992 | 2790 | 14644 | 43 |
| Chile (CL) | 987 | 2809 | 14874 | 41 |
| Colombia (CO) | 983 | 2873 | 14765 | 41 |
| Bulgaria (BG) | 970 | 2791 | 14809 | 42 |
| Croatia (HR) | 963 | 2720 | 14737 | 41 |
| Namibia (NA) | 961 | 2729 | 15870 | 39 |
| Saudi Arabia (SA) | 955 | 2952 | 15909 | 37 |
| Georgia (GE) | 953 | 2867 | 15721 | 40 |
| Tunisia (TN) | 952 | 2828 | 15425 | 38 |
| Botswana (BW) | 943 | 2769 | 15657 | 34 |
| Hong Kong (HK) | 941 | 2782 | 14308 | 39 |
| Kenya (KE) | 930 | 2887 | 15289 | 37 |
| Armenia (AM) | 928 | 2762 | 15381 | 41 |
| Zimbabwe (ZW) | 924 | 2746 | 15336 | 37 |
| Thailand (TH) | 920 | 2807 | 14409 | 40 |
| Bangladesh (BD) | 917 | 2909 | 14810 | 38 |
| Senegal (SN) | 915 | 2697 | 15366 | 35 |
| Serbia (RS) | 909 | 2636 | 14210 | 41 |
| Pakistan (PK) | 905 | 2870 | 14863 | 38 |
| Cameroon (CM) | 899 | 2651 | 15055 | 34 |
| Algeria (DZ) | 893 | 2702 | 15265 | 36 |
| Peru (PE) | 886 | 2544 | 13067 | 42 |
| Rwanda (RW) | 883 | 2594 | 13474 | 34 |
| Latvia (LV) | 882 | 2504 | 14066 | 41 |
| Kazakhstan (KZ) | 876 | 2657 | 14706 | 39 |
| Azerbaijan (AZ) | 869 | 2648 | 14571 | 36 |
| Qatar (QA) | 865 | 2596 | 15431 | 35 |
| Lithuania (LT) | 853 | 2423 | 13218 | 42 |
| Lebanon (LB) | 849 | 2559 | 14397 | 34 |
| Slovakia (SK) | 830 | 2284 | 11717 | 42 |
| Vietnam (VN) | 830 | 2612 | 13042 | 42 |
| Venezuela (VE) | 827 | 2514 | 13877 | 37 |
| Sri Lanka (LK) | 808 | 2576 | 13881 | 38 |
| Bahrain (BH) | 799 | 2385 | 13930 | 36 |
| Costa Rica (CR) | 797 | 2313 | 13332 | 42 |
| Dominican Republic (DO) | 791 | 2318 | 13489 | 37 |
| Tanzania (TZ) | 791 | 2435 | 13434 | 38 |
| Uzbekistan (UZ) | 788 | 2480 | 13474 | 39 |
| Slovenia (SI) | 785 | 2105 | 11569 | 40 |
| Ecuador (EC) | 780 | 2330 | 12739 | 37 |
| Ethiopia (ET) | 773 | 2395 | 12910 | 34 |
| Kuwait (KW) | 751 | 2257 | 13019 | 34 |
| Mozambique (MZ) | 749 | 2216 | 12772 | 34 |
| Jordan (JO) | 742 | 2293 | 12731 | 36 |
| Angola (AO) | 734 | 2249 | 12737 | 31 |
| Nepal (NP) | 732 | 2321 | 12241 | 37 |
| Oman (OM) | 727 | 2161 | 12812 | 34 |
| Uruguay (UY) | 726 | 1964 | 10920 | 40 |
| Zambia (ZM) | 720 | 2128 | 11565 | 36 |
| Bolivia (BO) | 712 | 2125 | 12185 | 35 |
| Panama (PA) | 695 | 1978 | 10910 | 38 |
| Iraq (IQ) | 680 | 2168 | 11542 | 37 |
| Guatemala (GT) | 670 | 2002 | 11610 | 38 |
| Mongolia (MN) | 670 | 2055 | 11351 | 36 |
| Cambodia (KH) | 638 | 1971 | 11428 | 35 |
| Paraguay (PY) | 594 | 1699 | 9850 | 32 |
| Myanmar (MM) | 536 | 1751 | 9931 | 29 |
