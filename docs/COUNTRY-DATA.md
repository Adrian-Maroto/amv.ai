# Country data: what each country really has

Written by `node scripts/country-report.mjs` from `data/countries/` (data of 2026-11-25).
A service is an organisation Wikidata files under that country, with an official
website, not closed, ranked by how many Wikipedia editions cover it. Tasks and Crew
jobs are what the page builds from those services, counted with the page's own
tables. Nothing is padded: a country with few entries on Wikidata shows few.

- Countries: **104**. Services: **109647**. Tasks: **322225**. Crew jobs, added up country by country: **1695796**.
- Distinct Crew jobs across all countries - what "See all jobs" holds, a service listed in several countries counted once: **1026269**.
- 500 or more services (Integrations): **104** countries. 200 or more: **104**. Under 200: **0**.
- 500 or more tasks: **104** countries. 500 or more Crew jobs: **104** countries.

| Country | Services | Tasks | Crew jobs | Kinds |
|---|---:|---:|---:|---:|
| United Kingdom (GB) | 1811 | 5233 | 25491 | 45 |
| Germany (DE) | 1767 | 5098 | 24889 | 45 |
| Canada (CA) | 1699 | 4778 | 24206 | 45 |
| United States (US) | 1698 | 4868 | 22400 | 44 |
| Australia (AU) | 1643 | 4691 | 23652 | 45 |
| France (FR) | 1640 | 4657 | 23560 | 45 |
| Netherlands (NL) | 1626 | 4533 | 23159 | 45 |
| Italy (IT) | 1617 | 4630 | 23382 | 45 |
| Spain (ES) | 1607 | 4619 | 23310 | 45 |
| Japan (JP) | 1546 | 4445 | 21363 | 45 |
| Switzerland (CH) | 1499 | 4306 | 22026 | 44 |
| Belgium (BE) | 1439 | 4055 | 21583 | 43 |
| Sweden (SE) | 1435 | 4056 | 21350 | 43 |
| Austria (AT) | 1426 | 4073 | 21132 | 44 |
| Denmark (DK) | 1418 | 3990 | 21128 | 42 |
| Russia (RU) | 1408 | 4102 | 19570 | 44 |
| New Zealand (NZ) | 1385 | 3933 | 20649 | 43 |
| Ireland (IE) | 1356 | 3820 | 20761 | 43 |
| Mexico (MX) | 1326 | 3913 | 19827 | 44 |
| India (IN) | 1323 | 3938 | 19468 | 43 |
| Israel (IL) | 1322 | 3715 | 19693 | 43 |
| China (CN) | 1316 | 3917 | 19012 | 44 |
| Poland (PL) | 1309 | 3770 | 17616 | 42 |
| Norway (NO) | 1303 | 3746 | 18128 | 44 |
| Ukraine (UA) | 1292 | 3850 | 19098 | 44 |
| Brazil (BR) | 1288 | 3816 | 18655 | 44 |
| Finland (FI) | 1283 | 3578 | 19609 | 44 |
| Czechia (CZ) | 1266 | 3675 | 18386 | 43 |
| Nigeria (NG) | 1255 | 3917 | 19079 | 41 |
| South Korea (KR) | 1254 | 3849 | 19141 | 44 |
| Türkiye (TR) | 1226 | 3647 | 17366 | 42 |
| Singapore (SG) | 1202 | 3494 | 19158 | 42 |
| Argentina (AR) | 1185 | 3563 | 18197 | 44 |
| Portugal (PT) | 1139 | 3223 | 16586 | 41 |
| Indonesia (ID) | 1118 | 3361 | 16009 | 42 |
| Ghana (GH) | 1108 | 3409 | 17598 | 38 |
| Greece (GR) | 1108 | 3064 | 16498 | 42 |
| Romania (RO) | 1102 | 3193 | 16201 | 42 |
| South Africa (ZA) | 1081 | 3137 | 16060 | 44 |
| Taiwan (TW) | 1078 | 3226 | 15681 | 42 |
| United Arab Emirates (AE) | 1067 | 3226 | 17504 | 38 |
| Egypt (EG) | 1035 | 3165 | 16470 | 38 |
| Philippines (PH) | 1033 | 3190 | 16327 | 41 |
| Uganda (UG) | 1032 | 3092 | 17178 | 41 |
| Morocco (MA) | 1025 | 3038 | 17326 | 40 |
| Malaysia (MY) | 1023 | 3057 | 16423 | 39 |
| Estonia (EE) | 1001 | 2795 | 15223 | 41 |
| Hungary (HU) | 995 | 2802 | 14728 | 43 |
| Chile (CL) | 990 | 2821 | 14958 | 41 |
| Colombia (CO) | 986 | 2885 | 14849 | 41 |
| Bulgaria (BG) | 973 | 2803 | 14893 | 42 |
| Croatia (HR) | 966 | 2732 | 14821 | 41 |
| Namibia (NA) | 963 | 2737 | 15926 | 39 |
| Georgia (GE) | 956 | 2879 | 15805 | 40 |
| Saudi Arabia (SA) | 956 | 2956 | 15937 | 37 |
| Tunisia (TN) | 956 | 2844 | 15537 | 38 |
| Botswana (BW) | 945 | 2777 | 15713 | 34 |
| Hong Kong (HK) | 943 | 2790 | 14364 | 39 |
| Kenya (KE) | 933 | 2899 | 15373 | 37 |
| Armenia (AM) | 931 | 2774 | 15465 | 41 |
| Zimbabwe (ZW) | 926 | 2754 | 15392 | 37 |
| Thailand (TH) | 921 | 2811 | 14437 | 40 |
| Bangladesh (BD) | 919 | 2917 | 14866 | 38 |
| Senegal (SN) | 919 | 2713 | 15478 | 35 |
| Serbia (RS) | 912 | 2648 | 14294 | 41 |
| Pakistan (PK) | 907 | 2878 | 14919 | 38 |
| Cameroon (CM) | 902 | 2663 | 15139 | 34 |
| Algeria (DZ) | 898 | 2721 | 15390 | 36 |
| Peru (PE) | 889 | 2556 | 13151 | 42 |
| Latvia (LV) | 885 | 2516 | 14150 | 41 |
| Rwanda (RW) | 884 | 2598 | 13502 | 34 |
| Kazakhstan (KZ) | 877 | 2661 | 14734 | 39 |
| Azerbaijan (AZ) | 872 | 2660 | 14655 | 36 |
| Qatar (QA) | 867 | 2604 | 15487 | 35 |
| Lithuania (LT) | 856 | 2435 | 13302 | 42 |
| Lebanon (LB) | 853 | 2574 | 14494 | 34 |
| Slovakia (SK) | 832 | 2292 | 11773 | 42 |
| Venezuela (VE) | 831 | 2529 | 13974 | 37 |
| Vietnam (VN) | 831 | 2616 | 13070 | 42 |
| Sri Lanka (LK) | 812 | 2591 | 13978 | 38 |
| Bahrain (BH) | 801 | 2393 | 13986 | 36 |
| Costa Rica (CR) | 800 | 2325 | 13416 | 42 |
| Dominican Republic (DO) | 794 | 2330 | 13573 | 37 |
| Tanzania (TZ) | 793 | 2443 | 13490 | 38 |
| Uzbekistan (UZ) | 789 | 2484 | 13502 | 39 |
| Slovenia (SI) | 787 | 2113 | 11625 | 40 |
| Ecuador (EC) | 783 | 2342 | 12823 | 37 |
| Ethiopia (ET) | 775 | 2403 | 12966 | 34 |
| Kuwait (KW) | 753 | 2265 | 13075 | 34 |
| Mozambique (MZ) | 752 | 2227 | 12841 | 34 |
| Jordan (JO) | 746 | 2308 | 12828 | 36 |
| Angola (AO) | 737 | 2261 | 12821 | 31 |
| Nepal (NP) | 733 | 2325 | 12269 | 37 |
| Oman (OM) | 729 | 2169 | 12868 | 34 |
| Uruguay (UY) | 729 | 1976 | 11004 | 40 |
| Zambia (ZM) | 721 | 2132 | 11593 | 36 |
| Bolivia (BO) | 716 | 2140 | 12282 | 35 |
| Panama (PA) | 698 | 1990 | 10994 | 38 |
| Iraq (IQ) | 684 | 2183 | 11639 | 37 |
| Guatemala (GT) | 673 | 2014 | 11694 | 38 |
| Mongolia (MN) | 672 | 2063 | 11407 | 36 |
| Cambodia (KH) | 640 | 1979 | 11484 | 35 |
| Paraguay (PY) | 598 | 1714 | 9947 | 32 |
| Myanmar (MM) | 538 | 1759 | 9987 | 29 |
