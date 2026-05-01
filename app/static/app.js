    // =====================
    // THEME
    // =====================
    function toggleTheme() {
        const dark = document.body.classList.toggle("dark");
        const btn  = document.getElementById("themeToggle");
        btn.innerHTML = dark ? "&#9728; Light" : "&#9790; Dark";
        localStorage.setItem("theme", dark ? "dark" : "light");
    }
    // Sync button label on load (class already applied by inline script above)
    document.addEventListener("DOMContentLoaded", function() {
        const btn = document.getElementById("themeToggle");
        if (document.body.classList.contains("dark")) btn.innerHTML = "&#9728; Light";
        switchTab("myview");
    });

    // =====================
    // STATE
    // =====================
    const selected       = new Map();   // id → opportunity object
    const reviewMeta     = new Map();   // id → { score, notes }
    const triageSelected = new Set();   // ids checked in review tab for triage

    let activeSource      = "fat";
    let stagesPopulated   = false;
    let debounceTimer;
    let currentData       = [];
    let sortedData        = [];
    let currentPage       = 1;
    const PAGE_SIZE       = 50;
    let batchMeta         = { batches: [], active_batch_id: null, last_seen_batch_id: null };
    let awardsData        = [];
    let triageSessions    = [];
    let collapsedSessions = new Set();

    // Fullscreen state
    let fsMode    = "triage";  // "triage" | "review"
    let fsSession = null;
    let fsOpps    = [];
    let fsIndex   = 0;
    let fsNotes   = {};

    const KNOWN_STAGES = [
        "tender","tenderUpdate","preQualification",
        "planning","planningUpdate",
        "award","awardUpdate","contract","contractUpdate",
    ];

    // =====================
    // TABS
    // =====================
    function switchTab(name) {
        // opps/review/triage are sub-tabs inside "tenders"
        const subNames = ["opps", "review", "triage"];
        const topName  = subNames.includes(name) ? "tenders" : name;
        document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
        const topTab = document.getElementById("tab-" + topName);
        if (topTab) topTab.classList.add("active");
        const topPanel = document.getElementById("panel-" + topName);
        if (topPanel) topPanel.classList.add("active");
        if (subNames.includes(name)) switchSubTab(name);
        if (name === "dashboard") fetchAndRenderDashboard();
        if (name === "myview")    initMyView();
    }

    function switchSubTab(name) {
        document.querySelectorAll(".sub-nav-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".sub-panel").forEach(p => p.classList.remove("active"));
        const btn   = document.getElementById("subnav-" + name);
        const panel = document.getElementById("sub-panel-" + name);
        if (btn)   btn.classList.add("active");
        if (panel) panel.classList.add("active");
        if (name === "review") renderReview();
        if (name === "triage") renderTriage();
        // ensure parent tenders tab is active
        document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
        const tendersTab = document.getElementById("tab-tenders");
        if (tendersTab) tendersTab.classList.add("active");
        const tendersPanel = document.getElementById("panel-tenders");
        if (tendersPanel) tendersPanel.classList.add("active");
    }

    function initMyView() {
        const now    = new Date();
        const dateEl = document.getElementById("mv-date");
        if (dateEl) dateEl.textContent = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
        const sel    = document.getElementById("mv-view-select");
        setMyView(sel ? sel.value : "bidmanager");
    }

    // =====================
    // MY VIEW — OFFERING VIEWS
    // =====================
    const MV_VIEWS = {
        bidmanager: {
            name: "Toby",
            subtitle: "Your procurement intelligence overview &mdash; DXC Technology",
            stats: [
                { icon: "&#128202;", num: "47",          label: "New Today",          trendClass: "up",   trend: "&#8593; 12 from yesterday" },
                { icon: "&#128203;", num: "12",          label: "Tracked",            trendClass: "",     trend: "3 in active pursuit" },
                { icon: "&#128176;", num: "&#163;48.2M", label: "Pipeline Value",     trendClass: "up",   trend: "Across 5 pursuits" },
                { icon: "&#9200;",   num: "3",           label: "Closing This Week",  trendClass: "warn", trend: "&#9888; Action required" }
            ],
            b1: { title: "New Opportunities",  icon: "&#9733;", iconCls: "mv-icon-blue",   linkText: "View all &rarr;",       linkAction: "switchTab('opps')" },
            b2: { title: "Account Views",       icon: "&#9632;", iconCls: "mv-icon-orange", linkText: "Open dashboard &rarr;", linkAction: "switchTab('dashboard')" },
            b3: { title: "Upcoming Deadlines",  icon: "&#9888;", iconCls: "mv-icon-amber",  linkText: null },
            b4: { title: "Pursuit Pipeline",    icon: "&#9650;", iconCls: "mv-icon-green",  linkText: "View triage &rarr;",    linkAction: "switchTab('triage')" },
            opps: [
                { t: "Digital Workplace Transformation Services",  b: "NHS Digital",         stage: "tender",   sc: "mv-pill-blue",   src: "FaT", srcc: "mv-pill-fat", v: "&#163;12.4M" },
                { t: "Managed Security Operations Centre (MSOC)",  b: "HMRC",                stage: "tender",   sc: "mv-pill-blue",   src: "FaT", srcc: "mv-pill-fat", v: "&#163;24.0M" },
                { t: "Network Infrastructure Refresh Programme",   b: "Dept for Transport",  stage: "planning", sc: "mv-pill-orange", src: "FaT", srcc: "mv-pill-fat", v: "&#163;8.1M"  },
                { t: "End User Device Management &amp; Support",   b: "Home Office",         stage: "tender",   sc: "mv-pill-blue",   src: "CF",  srcc: "mv-pill-cf",  v: "&#163;5.6M"  },
                { t: "Cloud Migration &amp; Managed Services",     b: "Cabinet Office",      stage: "tender",   sc: "mv-pill-blue",   src: "FaT", srcc: "mv-pill-fat", v: "&#163;6.8M"  }
            ],
            bars: [
                { n: "Sherlock",    c: "#4a90d9", grad: "#4a90d9,#60a5fa", count: "34 matches today", pct: 88, cpvs: "CPV 72, 48 &middot; IT Services &amp; Software" },
                { n: "White Lotus", c: "#E8583A", grad: "#E8583A,#fb923c", count: "12 matches today", pct: 31, cpvs: "CPV 48, 79 &middot; Software &amp; Consulting" },
                { n: "Horizon",     c: "#27a050", grad: "#27a050,#34d399", count: "8 matches today",  pct: 21, cpvs: "CPV 50, 72 &middot; Maintenance &amp; IT" },
                { n: "Meridian",    c: "#9333ea", grad: "#9333ea,#c084fc", count: "5 matches today",  pct: 13, cpvs: "CPV 32, 72 &middot; Telecoms &amp; IT" }
            ],
            deadlines: [
                { day: "2",  mon: "May", urg: "mv-badge-urgent", t: "Digital Workplace Transformation",   b: "NHS Digital",        days: "3 days",  dc: "mv-days-urgent" },
                { day: "8",  mon: "May", urg: "mv-badge-soon",   t: "Managed Security Operations Centre", b: "HMRC",               days: "9 days",  dc: "mv-days-soon"   },
                { day: "14", mon: "May", urg: "mv-badge-ok",     t: "Network Infrastructure Refresh",     b: "Dept for Transport", days: "15 days", dc: "mv-days-ok"     },
                { day: "20", mon: "May", urg: "mv-badge-ok",     t: "Enterprise IT Outsourcing",          b: "Ministry of Defence",days: "21 days", dc: "mv-days-ok"     }
            ],
            pipeline: [
                { c: "#9333ea", n: "Enterprise IT Outsourcing &mdash; MOD",  v: "&#163;45.0M", pct: 93 },
                { c: "#4a90d9", n: "Managed Services Bundle &mdash; NHS",    v: "&#163;22.8M", pct: 47 },
                { c: "#E8583A", n: "Digital Transformation &mdash; DWP",     v: "&#163;18.3M", pct: 38 },
                { c: "#27a050", n: "Cybersecurity Services &mdash; GCHQ",    v: "&#163;9.1M",  pct: 19 },
                { c: "#f59e0b", n: "Cloud Migration &mdash; Cabinet Office", v: "&#163;6.8M",  pct: 14 }
            ],
            total: "&#163;102.0M",
            pursuits: [
                {
                    t: "Enterprise IT Outsourcing Programme",
                    b: "Ministry of Defence",
                    v: "&#163;45.0M", months: "60 months",
                    deadline: { day: "20", mon: "May", days: "21 days", dc: "mv-days-ok", urg: "mv-badge-ok" },
                    status: "In Pursuit", statusCls: "mv-bid-status--active",
                    teamStatus: [
                        { offering: "Security",  state: "in",      note: "Qualified in &mdash; 28 Apr" },
                        { offering: "Cloud",     state: "pending",  note: "Awaiting input by 5 May" },
                        { offering: "Workplace", state: "in",       note: "Qualified in &mdash; 26 Apr" },
                        { offering: "Network",   state: "pending",  note: "Input requested &mdash; 29 Apr" }
                    ],
                    ai: "High-value strategic pursuit representing significant long-term account growth. DXC's existing defence relationships and SC-cleared staff provide a credible baseline. Key risks: incumbent advantage and complex multi-tower scope. Recommend forming a dedicated pursuit team; bid/win review by 10 May. Position on Total Cost of Ownership savings. Priority: TIER 1."
                },
                {
                    t: "Managed Services Bundle",
                    b: "NHS England",
                    v: "&#163;22.8M", months: "36 months",
                    deadline: { day: "28", mon: "May", days: "29 days", dc: "mv-days-ok", urg: "mv-badge-ok" },
                    status: "Qualification In Progress", statusCls: "mv-bid-status--qualifying",
                    teamStatus: [
                        { offering: "Security",  state: "pending",  note: "In review &mdash; response due 3 May" },
                        { offering: "Cloud",     state: "in",       note: "Qualified in &mdash; 27 Apr" },
                        { offering: "Workplace", state: "in",       note: "Qualified in &mdash; 25 Apr" },
                        { offering: "Network",   state: "na",       note: "Not applicable to this scope" }
                    ],
                    ai: "NHS England bundle covering managed services across cloud, workplace and security. Strong DXC NHS footprint gives incumbent advantage. Qualification phase ongoing &mdash; awaiting Security team input by 3 May. Key differentiator: single-supplier model reducing NHS management overhead. DSP Toolkit compliance must be front-and-centre. Priority: TIER 1."
                },
                {
                    t: "Digital Transformation Programme",
                    b: "DWP",
                    v: "&#163;18.3M", months: "48 months",
                    deadline: { day: "4", mon: "Jun", days: "36 days", dc: "mv-days-ok", urg: "mv-badge-ok" },
                    status: "Qualification In Progress", statusCls: "mv-bid-status--qualifying",
                    teamStatus: [
                        { offering: "Security",  state: "pending",  note: "Awaiting input by 8 May" },
                        { offering: "Cloud",     state: "pending",  note: "In review" },
                        { offering: "Workplace", state: "in",       note: "Qualified in &mdash; 29 Apr" },
                        { offering: "Network",   state: "out",      note: "Qualified out &mdash; 28 Apr" }
                    ],
                    ai: "DWP large-scale digital transformation spanning legacy modernisation, cloud and workplace. Network has been qualified out. Awaiting Cloud and Security qualification decisions. Response timeframe is relaxed &mdash; use the runway to build a strong commercial model. Consider G-Cloud route to market. Priority: TIER 2."
                },
                {
                    t: "Cybersecurity Services",
                    b: "GCHQ",
                    v: "&#163;9.1M", months: "24 months",
                    deadline: { day: "12", mon: "May", days: "13 days", dc: "mv-days-soon", urg: "mv-badge-soon" },
                    status: "Shortlisted &mdash; Awaiting ITT", statusCls: "mv-bid-status--shortlisted",
                    teamStatus: [
                        { offering: "Security",  state: "in",  note: "Qualified in &mdash; 30 Apr" },
                        { offering: "Cloud",     state: "na",  note: "Not applicable" },
                        { offering: "Workplace", state: "na",  note: "Not applicable" },
                        { offering: "Network",   state: "na",  note: "Not applicable" }
                    ],
                    ai: "Security-only pursuit. DXC Security team confirmed qualification in. Waiting on ITT release expected week of 12 May. Strong SC-cleared team available. Assign senior security architect to lead response. Timeline is tight &mdash; pre-position now. Priority: TIER 1."
                },
                {
                    t: "Cloud Migration &amp; Managed Services",
                    b: "Cabinet Office",
                    v: "&#163;6.8M", months: "24 months",
                    deadline: { day: "3", mon: "May", days: "4 days", dc: "mv-days-urgent", urg: "mv-badge-urgent" },
                    status: "Response Due", statusCls: "mv-bid-status--urgent",
                    teamStatus: [
                        { offering: "Security",  state: "out",  note: "Qualified out &mdash; 27 Apr" },
                        { offering: "Cloud",     state: "in",   note: "Qualified in &mdash; 28 Apr" },
                        { offering: "Workplace", state: "na",   note: "Not applicable" },
                        { offering: "Network",   state: "na",   note: "Not applicable" }
                    ],
                    ai: "Cloud migration led by Cloud offering. Security qualified out. URGENT: response deadline 3 May. Cloud team must submit draft by 1 May for internal review. Recommend Toby reviews commercial terms today. G-Cloud 14 framework route recommended. Priority: TIER 1 &mdash; URGENT."
                }
            ]
        },
        security: {
            name: "Security",
            subtitle: "Cyber &amp; Security Intelligence &mdash; DXC Technology",
            stats: [
                { icon: "&#128737;", num: "23",          label: "Security Tenders",   trendClass: "up",   trend: "&#8593; 5 from last week" },
                { icon: "&#128272;", num: "4",           label: "SOC Bids Active",    trendClass: "",     trend: "2 at shortlist stage" },
                { icon: "&#128176;", num: "&#163;42.3M", label: "Security Pipeline",  trendClass: "up",   trend: "Across 4 pursuits" },
                { icon: "&#9200;",   num: "2",           label: "Closing This Week",  trendClass: "warn", trend: "&#9888; Action required" }
            ],
            b1: { title: "Cyber &amp; Security Tenders", icon: "&#128737;", iconCls: "mv-icon-blue",   linkText: "View all &rarr;",       linkAction: "switchTab('opps')" },
            b2: { title: "Security Focus Areas",          icon: "&#9632;",   iconCls: "mv-icon-orange", linkText: "Open dashboard &rarr;", linkAction: "switchTab('dashboard')" },
            b3: { title: "Security Deadlines",            icon: "&#9888;",   iconCls: "mv-icon-amber",  linkText: null },
            b4: { title: "Security Pipeline",             icon: "&#9650;",   iconCls: "mv-icon-green",  linkText: "View triage &rarr;",    linkAction: "switchTab('triage')" },
            opps: [
                { t: "Managed Security Operations Centre",    b: "HMRC",                   stage: "tender",   sc: "mv-pill-blue",   src: "FaT", srcc: "mv-pill-fat", v: "&#163;24.0M" },
                { t: "Cyber Defence Platform Upgrade",        b: "Dept for Education",     stage: "tender",   sc: "mv-pill-blue",   src: "FaT", srcc: "mv-pill-fat", v: "&#163;7.2M"  },
                { t: "SOC as a Service &mdash; Government",   b: "NHS England",            stage: "planning", sc: "mv-pill-orange", src: "CF",  srcc: "mv-pill-cf",  v: "&#163;5.8M"  },
                { t: "Threat Intelligence Managed Service",   b: "Ministry of Defence",    stage: "tender",   sc: "mv-pill-blue",   src: "FaT", srcc: "mv-pill-fat", v: "&#163;9.1M"  },
                { t: "SIEM &amp; SOAR Platform Refresh",      b: "HM Government Digital",  stage: "planning", sc: "mv-pill-orange", src: "FaT", srcc: "mv-pill-fat", v: "&#163;3.4M"  }
            ],
            bars: [
                { n: "SecureGov",    c: "#2E6BE6", grad: "#2E6BE6,#60a5fa", count: "12 matches", pct: 75, cpvs: "CPV 72.2 &middot; Cyber Security" },
                { n: "GCHQ Anchor", c: "#E8583A", grad: "#E8583A,#fb923c", count: "8 matches",  pct: 52, cpvs: "CPV 72.2, 72.7 &middot; Security Ops" },
                { n: "MOD Cyber",   c: "#9333ea", grad: "#9333ea,#c084fc", count: "5 matches",  pct: 38, cpvs: "CPV 72.2 &middot; Threat Intel" },
                { n: "NHS Security",c: "#27a050", grad: "#27a050,#34d399", count: "3 matches",  pct: 22, cpvs: "CPV 72.2, 48 &middot; SOC Services" }
            ],
            deadlines: [
                { day: "3",  mon: "May", urg: "mv-badge-urgent", t: "Managed SOC &mdash; HMRC",           b: "HMRC",               days: "4 days",  dc: "mv-days-urgent" },
                { day: "9",  mon: "May", urg: "mv-badge-soon",   t: "Threat Intelligence Managed Service", b: "MOD",                days: "10 days", dc: "mv-days-soon"   },
                { day: "16", mon: "May", urg: "mv-badge-ok",     t: "SIEM Platform Refresh",              b: "HM Gov Digital",     days: "17 days", dc: "mv-days-ok"     },
                { day: "22", mon: "May", urg: "mv-badge-ok",     t: "Cyber Defence Platform",             b: "Dept for Education", days: "23 days", dc: "mv-days-ok"     }
            ],
            pipeline: [
                { c: "#2E6BE6", n: "Managed SOC &mdash; HMRC",        v: "&#163;24.0M", pct: 91 },
                { c: "#9333ea", n: "Threat Intel &mdash; MOD",         v: "&#163;9.1M",  pct: 35 },
                { c: "#E8583A", n: "SOC as a Service &mdash; NHS",     v: "&#163;5.8M",  pct: 22 },
                { c: "#27a050", n: "Cybersecurity &mdash; GCHQ",       v: "&#163;3.4M",  pct: 13 }
            ],
            total: "&#163;42.3M",
            reviewQueue: [
                {
                    t: "Managed Security Operations Centre",
                    b: "HMRC",
                    v: "&#163;24.0M",
                    months: "36 months",
                    deadline: { day: "3", mon: "May", urg: "mv-badge-urgent", days: "4 days", dc: "mv-days-urgent" },
                    tasks: ["Review Statement of Work documents", "Internal bid/no-bid call &mdash; 2 May", "Check incumbent contract expiry date"],
                    ai: "HMRC requires a comprehensive SOC capability including 24/7 monitoring, incident response, and threat hunting across their hybrid estate. DXC's existing relationship with HMRC and G-Cloud presence gives a strong incumbent advantage. Key differentiators should focus on our SIEM platform integration, UK-based analyst team, and proven response SLAs. Estimated win probability: HIGH. Bid/no-bid recommendation: PURSUE."
                },
                {
                    t: "Threat Intelligence Managed Service",
                    b: "Ministry of Defence",
                    v: "&#163;9.1M",
                    months: "24 months",
                    deadline: { day: "9", mon: "May", urg: "mv-badge-soon", days: "10 days", dc: "mv-days-soon" },
                    tasks: ["Verify SC clearance availability for bid team", "Review MOD framework eligibility", "Identify CTI teaming partner"],
                    ai: "MOD is seeking a threat intelligence platform with OSINT feeds, dark web monitoring and fusion centre capabilities. The requirement aligns closely with DXC's ThreatSpark offering. SC clearance is mandatory for all personnel involved &mdash; verify team availability before committing. Consider teaming with a specialist CTI partner to strengthen credibility. Estimated win probability: MEDIUM. Bid/no-bid recommendation: QUALIFY FURTHER."
                },
                {
                    t: "Cyber Defence Platform Upgrade",
                    b: "Dept for Education",
                    v: "&#163;7.2M",
                    months: "18 months",
                    deadline: { day: "16", mon: "May", urg: "mv-badge-ok", days: "17 days", dc: "mv-days-ok" },
                    tasks: ["Confirm technical lead availability", "Review DfE security architecture documentation", "Cold pursuit feasibility check"],
                    ai: "DfE is upgrading legacy firewall and endpoint detection infrastructure across its estate. Relatively straightforward refresh scope &mdash; primary risk is incumbent switching costs given the existing integrations. DXC has no prior relationship with DfE; this is a cold pursuit. Assess whether the contract value and strategic fit justify the bid investment. Estimated win probability: LOW-MEDIUM. Bid/no-bid recommendation: ASSESS."
                },
                {
                    t: "SOC as a Service &mdash; Government",
                    b: "NHS England",
                    v: "&#163;5.8M",
                    months: "30 months",
                    deadline: { day: "22", mon: "May", urg: "mv-badge-ok", days: "23 days", dc: "mv-days-ok" },
                    tasks: ["Confirm NHS DSP Toolkit compliance requirements", "Review existing NHS framework contracts", "Draft capability statement"],
                    ai: "NHS England requires a fully managed SOC service covering SIEM, vulnerability management and Cyber Essentials Plus compliance monitoring across a complex, devolved estate. Highly regulated environment with strict UK data residency requirements. DXC's NHS footprint and existing HSCN connectivity are significant assets, but DSP Toolkit compliance obligations must be explicitly evidenced in the response. Estimated win probability: HIGH. Bid/no-bid recommendation: PURSUE."
                }
            ]
        },
        cloud: {
            name: "Cloud",
            subtitle: "Cloud &amp; Infrastructure Intelligence &mdash; DXC Technology",
            stats: [
                { icon: "&#9729;",   num: "18",          label: "Cloud Tenders",      trendClass: "up",   trend: "&#8593; 3 from last week" },
                { icon: "&#128640;", num: "6",           label: "Active Pursuits",    trendClass: "",     trend: "2 at final stage" },
                { icon: "&#128176;", num: "&#163;63.1M", label: "Cloud Pipeline",     trendClass: "up",   trend: "Across 5 pursuits" },
                { icon: "&#9200;",   num: "1",           label: "Closing Soon",       trendClass: "warn", trend: "&#9888; Deadline Friday" }
            ],
            b1: { title: "Cloud Migration Tenders", icon: "&#9729;", iconCls: "mv-icon-blue",   linkText: "View all &rarr;",       linkAction: "switchTab('opps')" },
            b2: { title: "Cloud Accounts",           icon: "&#9632;", iconCls: "mv-icon-orange", linkText: "Open dashboard &rarr;", linkAction: "switchTab('dashboard')" },
            b3: { title: "Cloud Deadlines",          icon: "&#9888;", iconCls: "mv-icon-amber",  linkText: null },
            b4: { title: "Cloud Pipeline",           icon: "&#9650;", iconCls: "mv-icon-green",  linkText: "View triage &rarr;",    linkAction: "switchTab('triage')" },
            opps: [
                { t: "Cloud Migration &amp; Managed Services",  b: "Cabinet Office",      stage: "tender",   sc: "mv-pill-blue",   src: "FaT", srcc: "mv-pill-fat", v: "&#163;6.8M"  },
                { t: "Azure Landing Zone &mdash; Government",   b: "DWP",                 stage: "planning", sc: "mv-pill-orange", src: "FaT", srcc: "mv-pill-fat", v: "&#163;18.5M" },
                { t: "Multi-Cloud Strategy Implementation",     b: "NHS England",         stage: "tender",   sc: "mv-pill-blue",   src: "CF",  srcc: "mv-pill-cf",  v: "&#163;22.0M" },
                { t: "Platform Engineering &amp; DevSecOps",    b: "Ministry of Defence", stage: "tender",   sc: "mv-pill-blue",   src: "FaT", srcc: "mv-pill-fat", v: "&#163;11.3M" },
                { t: "IaaS &amp; Cloud Hosting Services",       b: "DVLA",                stage: "planning", sc: "mv-pill-orange", src: "FaT", srcc: "mv-pill-fat", v: "&#163;4.5M"  }
            ],
            bars: [
                { n: "CloudFirst Gov",   c: "#2E6BE6", grad: "#2E6BE6,#60a5fa", count: "18 matches", pct: 91, cpvs: "CPV 72.2, 48 &middot; Cloud Platforms" },
                { n: "Azure Programme",  c: "#E8583A", grad: "#E8583A,#fb923c", count: "12 matches", pct: 65, cpvs: "CPV 72.2 &middot; IaaS / PaaS" },
                { n: "Hybrid Cloud NHS", c: "#27a050", grad: "#27a050,#34d399", count: "8 matches",  pct: 43, cpvs: "CPV 72.2, 72.3 &middot; Hybrid Cloud" },
                { n: "HyperScaler MOD",  c: "#9333ea", grad: "#9333ea,#c084fc", count: "5 matches",  pct: 28, cpvs: "CPV 72.2 &middot; Cloud Security" }
            ],
            deadlines: [
                { day: "1",  mon: "May", urg: "mv-badge-urgent", t: "Azure Landing Zone &mdash; DWP",       b: "DWP",            days: "2 days",  dc: "mv-days-urgent" },
                { day: "11", mon: "May", urg: "mv-badge-soon",   t: "Multi-Cloud Strategy &mdash; NHS",      b: "NHS England",    days: "12 days", dc: "mv-days-soon"   },
                { day: "17", mon: "May", urg: "mv-badge-ok",     t: "Platform Engineering &mdash; MOD",      b: "MOD",            days: "18 days", dc: "mv-days-ok"     },
                { day: "25", mon: "May", urg: "mv-badge-ok",     t: "Cloud Migration &mdash; Cabinet Office",b: "Cabinet Office", days: "26 days", dc: "mv-days-ok"     }
            ],
            pipeline: [
                { c: "#27a050", n: "Multi-Cloud &mdash; NHS",         v: "&#163;22.0M", pct: 88 },
                { c: "#2E6BE6", n: "Azure Gov &mdash; DWP",           v: "&#163;18.5M", pct: 74 },
                { c: "#9333ea", n: "Platform Eng &mdash; MOD",        v: "&#163;11.3M", pct: 45 },
                { c: "#f59e0b", n: "Cloud Migration &mdash; CO",      v: "&#163;6.8M",  pct: 27 },
                { c: "#E8583A", n: "IaaS &mdash; DVLA",               v: "&#163;4.5M",  pct: 18 }
            ],
            total: "&#163;63.1M",
            reviewQueue: [
                {
                    t: "Azure Landing Zone &mdash; Government",
                    b: "DWP",
                    v: "&#163;18.5M",
                    months: "36 months",
                    deadline: { day: "1", mon: "May", urg: "mv-badge-urgent", days: "2 days", dc: "mv-days-urgent" },
                    tasks: ["Confirm Azure SME resource availability", "Review DWP cloud strategy document", "Prepare G-Cloud 14 commercial response"],
                    ai: "DWP is procuring a full Azure landing zone covering identity, networking, governance and workload migration. This is a large-scale modernisation programme with strong strategic alignment to DXC's cloud-first positioning. G-Cloud 14 is the likely vehicle; confirm with DWP commercial team. Resource risk: specialist Azure architects are currently deployed on the NHS programme &mdash; escalate allocation conflict to delivery director. Estimated win probability: HIGH. Bid/no-bid recommendation: PURSUE."
                },
                {
                    t: "Multi-Cloud Strategy Implementation",
                    b: "NHS England",
                    v: "&#163;22.0M",
                    months: "48 months",
                    deadline: { day: "11", mon: "May", urg: "mv-badge-soon", days: "12 days", dc: "mv-days-soon" },
                    tasks: ["Coordinate with Security offering on shared resource plan", "Review NHS cloud strategy whitepaper", "Validate multi-cloud tooling stack (Terraform, Kubernetes)"],
                    ai: "NHS England is seeking a strategic partner to deliver a multi-cloud operating model across Azure, AWS and on-prem hybrid. Scope includes FinOps tooling, platform engineering and migration factory. DXC has existing HSCN connectivity and NHS platform knowledge that are major differentiators. Coordinate with Security offering &mdash; SOC services are likely to be bundled. Highest value opportunity in current cloud pipeline. Estimated win probability: HIGH. Bid/no-bid recommendation: PURSUE."
                },
                {
                    t: "Platform Engineering &amp; DevSecOps",
                    b: "Ministry of Defence",
                    v: "&#163;11.3M",
                    months: "24 months",
                    deadline: { day: "17", mon: "May", urg: "mv-badge-ok", days: "18 days", dc: "mv-days-ok" },
                    tasks: ["Confirm SC clearance for platform team", "Review MOD DevSecOps toolchain requirements", "Assess teaming options for specialist CI/CD capability"],
                    ai: "MOD requires a platform engineering partner to establish a developer platform (IDP) with embedded DevSecOps pipelines, container orchestration and automated compliance scanning. SC clearance is mandatory across all delivery personnel. DXC's existing MOD relationship and accredited cloud infrastructure are strong entry points. Estimated win probability: MEDIUM. Bid/no-bid recommendation: QUALIFY FURTHER."
                }
            ]
        },
        workplace: {
            name: "Workplace",
            subtitle: "Workplace &amp; Modern Compute Intelligence &mdash; DXC Technology",
            stats: [
                { icon: "&#128187;", num: "31",          label: "Workplace Tenders",  trendClass: "up",   trend: "&#8593; 7 from last week" },
                { icon: "&#128203;", num: "7",           label: "Active Bids",        trendClass: "",     trend: "3 at shortlist stage" },
                { icon: "&#128176;", num: "&#163;30.4M", label: "Workplace Pipeline", trendClass: "up",   trend: "Across 4 pursuits" },
                { icon: "&#9200;",   num: "4",           label: "Closing This Week",  trendClass: "warn", trend: "&#9888; Multiple deadlines" }
            ],
            b1: { title: "Workplace Tenders",   icon: "&#128187;", iconCls: "mv-icon-blue",   linkText: "View all &rarr;",       linkAction: "switchTab('opps')" },
            b2: { title: "Workplace Accounts",  icon: "&#9632;",   iconCls: "mv-icon-orange", linkText: "Open dashboard &rarr;", linkAction: "switchTab('dashboard')" },
            b3: { title: "Workplace Deadlines", icon: "&#9888;",   iconCls: "mv-icon-amber",  linkText: null },
            b4: { title: "Workplace Pipeline",  icon: "&#9650;",   iconCls: "mv-icon-green",  linkText: "View triage &rarr;",    linkAction: "switchTab('triage')" },
            opps: [
                { t: "Digital Workplace Transformation",           b: "NHS Digital",        stage: "tender",   sc: "mv-pill-blue",   src: "FaT", srcc: "mv-pill-fat", v: "&#163;12.4M" },
                { t: "End User Device Management &amp; Support",   b: "Home Office",        stage: "tender",   sc: "mv-pill-blue",   src: "CF",  srcc: "mv-pill-cf",  v: "&#163;5.6M"  },
                { t: "Modern Workplace Services",                  b: "HMRC",               stage: "planning", sc: "mv-pill-orange", src: "FaT", srcc: "mv-pill-fat", v: "&#163;8.3M"  },
                { t: "Virtual Desktop Infrastructure",             b: "HM Treasury",        stage: "tender",   sc: "mv-pill-blue",   src: "FaT", srcc: "mv-pill-fat", v: "&#163;4.1M"  },
                { t: "Collaboration Platform &amp; Unified Comms", b: "Dept for Transport", stage: "planning", sc: "mv-pill-orange", src: "CF",  srcc: "mv-pill-cf",  v: "&#163;2.9M"  }
            ],
            bars: [
                { n: "Digital Workplace NHS",  c: "#4a90d9", grad: "#4a90d9,#60a5fa", count: "14 matches", pct: 83, cpvs: "CPV 72, 48 &middot; Workplace &amp; EUC" },
                { n: "Home Office EUD",        c: "#E8583A", grad: "#E8583A,#fb923c", count: "9 matches",  pct: 57, cpvs: "CPV 30, 72 &middot; Device &amp; Support" },
                { n: "Modern Workspace HMRC",  c: "#27a050", grad: "#27a050,#34d399", count: "7 matches",  pct: 42, cpvs: "CPV 48, 72 &middot; Software &amp; Managed" },
                { n: "DfT Collaboration",      c: "#9333ea", grad: "#9333ea,#c084fc", count: "3 matches",  pct: 18, cpvs: "CPV 32, 48 &middot; UC &amp; Collab" }
            ],
            deadlines: [
                { day: "2",  mon: "May", urg: "mv-badge-urgent", t: "Digital Workplace Transformation",     b: "NHS Digital",  days: "3 days",  dc: "mv-days-urgent" },
                { day: "5",  mon: "May", urg: "mv-badge-urgent", t: "VDI Infrastructure &mdash; HM Treasury",b: "HM Treasury", days: "6 days",  dc: "mv-days-urgent" },
                { day: "12", mon: "May", urg: "mv-badge-soon",   t: "Modern Workplace Services",            b: "HMRC",         days: "13 days", dc: "mv-days-soon"   },
                { day: "19", mon: "May", urg: "mv-badge-ok",     t: "EUD Management &mdash; Home Office",   b: "Home Office",  days: "20 days", dc: "mv-days-ok"     }
            ],
            pipeline: [
                { c: "#4a90d9", n: "Digital Workplace &mdash; NHS",  v: "&#163;12.4M", pct: 87 },
                { c: "#E8583A", n: "Modern Workplace &mdash; HMRC",  v: "&#163;8.3M",  pct: 59 },
                { c: "#27a050", n: "EUD &mdash; Home Office",         v: "&#163;5.6M",  pct: 40 },
                { c: "#9333ea", n: "VDI &mdash; HM Treasury",         v: "&#163;4.1M",  pct: 29 }
            ],
            total: "&#163;30.4M",
            reviewQueue: [
                {
                    t: "Digital Workplace Transformation",
                    b: "NHS Digital",
                    v: "&#163;12.4M",
                    months: "36 months",
                    deadline: { day: "2", mon: "May", urg: "mv-badge-urgent", days: "3 days", dc: "mv-days-urgent" },
                    tasks: ["Finalise device catalogue and imaging plan", "Confirm M365 licensing commercial approach", "Review NHS acceptable use policy alignment"],
                    ai: "NHS Digital is transforming its workplace with Microsoft 365, modern device management (Intune/SCCM) and hybrid working infrastructure. DXC's existing NHS presence and M365 deployment credentials are decisive differentiators. URGENT: submission deadline in 3 days &mdash; response lead must be confirmed today. Strong fit for DXC Workplace offerings. Estimated win probability: HIGH. Bid/no-bid recommendation: PURSUE."
                },
                {
                    t: "Virtual Desktop Infrastructure",
                    b: "HM Treasury",
                    v: "&#163;4.1M",
                    months: "24 months",
                    deadline: { day: "5", mon: "May", urg: "mv-badge-urgent", days: "6 days", dc: "mv-days-urgent" },
                    tasks: ["Evaluate Citrix vs Azure Virtual Desktop approach", "Confirm SC clearance for delivery team", "Prepare capacity and performance SLA model"],
                    ai: "HM Treasury requires a VDI platform for approximately 3,500 users across secure and standard network segments. Two viable approaches: Citrix DaaS (existing DXC licence relationships) or Azure Virtual Desktop (lower cost, cloud-native). SC clearance required. Recommend Azure Virtual Desktop as primary option with Citrix as fallback &mdash; aligns to HM Treasury cloud-first policy. Estimated win probability: MEDIUM-HIGH. Bid/no-bid recommendation: PURSUE."
                },
                {
                    t: "Modern Workplace Services",
                    b: "HMRC",
                    v: "&#163;8.3M",
                    months: "30 months",
                    deadline: { day: "12", mon: "May", urg: "mv-badge-soon", days: "13 days", dc: "mv-days-soon" },
                    tasks: ["Review HMRC desktop refresh scope", "Check incumbent contract overlap", "Draft capability statement for M365 and device services"],
                    ai: "HMRC is modernising its end-user compute estate including PC refresh, M365 migration and a new service desk operating model. DXC already supports HMRC on SOC services, giving an established relationship advantage. Incumbent risk is moderate. Key message: integrated workplace + security managed service proposition reduces HMRC supplier count. Estimated win probability: MEDIUM. Bid/no-bid recommendation: QUALIFY FURTHER."
                }
            ]
        },
        network: {
            name: "Network &amp; Infra",
            subtitle: "Network Infrastructure Intelligence &mdash; DXC Technology",
            stats: [
                { icon: "&#128268;", num: "14",          label: "Network Tenders",    trendClass: "up",   trend: "&#8593; 2 from last week" },
                { icon: "&#128203;", num: "3",           label: "Active Pursuits",    trendClass: "",     trend: "1 at final evaluation" },
                { icon: "&#128176;", num: "&#163;39.7M", label: "Network Pipeline",   trendClass: "up",   trend: "Across 4 pursuits" },
                { icon: "&#9200;",   num: "2",           label: "Closing This Week",  trendClass: "warn", trend: "&#9888; Review required" }
            ],
            b1: { title: "Network &amp; Infra Tenders", icon: "&#128268;", iconCls: "mv-icon-blue",   linkText: "View all &rarr;",       linkAction: "switchTab('opps')" },
            b2: { title: "Network Accounts",             icon: "&#9632;",   iconCls: "mv-icon-orange", linkText: "Open dashboard &rarr;", linkAction: "switchTab('dashboard')" },
            b3: { title: "Network Deadlines",            icon: "&#9888;",   iconCls: "mv-icon-amber",  linkText: null },
            b4: { title: "Network Pipeline",             icon: "&#9650;",   iconCls: "mv-icon-green",  linkText: "View triage &rarr;",    linkAction: "switchTab('triage')" },
            opps: [
                { t: "Network Infrastructure Refresh Programme",  b: "Dept for Transport",    stage: "planning", sc: "mv-pill-orange", src: "FaT", srcc: "mv-pill-fat", v: "&#163;8.1M"  },
                { t: "SD-WAN Managed Service Procurement",        b: "Ministry of Defence",   stage: "tender",   sc: "mv-pill-blue",   src: "FaT", srcc: "mv-pill-fat", v: "&#163;14.6M" },
                { t: "MPLS Network Replacement",                  b: "HMRC",                  stage: "tender",   sc: "mv-pill-blue",   src: "CF",  srcc: "mv-pill-cf",  v: "&#163;9.8M"  },
                { t: "Core Network Services &mdash; NHS",         b: "NHS England",            stage: "planning", sc: "mv-pill-orange", src: "FaT", srcc: "mv-pill-fat", v: "&#163;7.2M"  },
                { t: "Government Connectivity Hub",               b: "Cabinet Office",         stage: "tender",   sc: "mv-pill-blue",   src: "FaT", srcc: "mv-pill-fat", v: "&#163;4.3M"  }
            ],
            bars: [
                { n: "DfT Net Refresh",  c: "#2E6BE6", grad: "#2E6BE6,#60a5fa", count: "8 matches", pct: 78, cpvs: "CPV 32, 72 &middot; Network &amp; Infra" },
                { n: "MOD SD-WAN",       c: "#E8583A", grad: "#E8583A,#fb923c", count: "6 matches", pct: 55, cpvs: "CPV 32.4 &middot; WAN &amp; MPLS" },
                { n: "HMRC Network",     c: "#27a050", grad: "#27a050,#34d399", count: "4 matches", pct: 34, cpvs: "CPV 32.5 &middot; Network Replacement" },
                { n: "NHS Connectivity", c: "#f59e0b", grad: "#f59e0b,#fcd34d", count: "2 matches", pct: 19, cpvs: "CPV 32, 72 &middot; Core Network" }
            ],
            deadlines: [
                { day: "4",  mon: "May", urg: "mv-badge-urgent", t: "SD-WAN Managed Service &mdash; MOD",    b: "MOD",         days: "5 days",  dc: "mv-days-urgent" },
                { day: "7",  mon: "May", urg: "mv-badge-soon",   t: "MPLS Network Replacement &mdash; HMRC", b: "HMRC",        days: "8 days",  dc: "mv-days-soon"   },
                { day: "15", mon: "May", urg: "mv-badge-ok",     t: "Core Network Services &mdash; NHS",     b: "NHS England", days: "16 days", dc: "mv-days-ok"     },
                { day: "23", mon: "May", urg: "mv-badge-ok",     t: "Network Infrastructure Refresh",        b: "DfT",         days: "24 days", dc: "mv-days-ok"     }
            ],
            pipeline: [
                { c: "#2E6BE6", n: "SD-WAN &mdash; MOD",     v: "&#163;14.6M", pct: 95 },
                { c: "#E8583A", n: "MPLS &mdash; HMRC",       v: "&#163;9.8M",  pct: 64 },
                { c: "#27a050", n: "Net Refresh &mdash; DfT", v: "&#163;8.1M",  pct: 53 },
                { c: "#f59e0b", n: "Core Net &mdash; NHS",    v: "&#163;7.2M",  pct: 47 }
            ],
            total: "&#163;39.7M",
            reviewQueue: [
                {
                    t: "SD-WAN Managed Service Procurement",
                    b: "Ministry of Defence",
                    v: "&#163;14.6M",
                    months: "48 months",
                    deadline: { day: "4", mon: "May", urg: "mv-badge-urgent", days: "5 days", dc: "mv-days-urgent" },
                    tasks: ["Confirm SC clearance for network team", "Review MOD connectivity blueprint", "Identify teaming partner for BRENT/MODNET integration"],
                    ai: "MOD requires a fully managed SD-WAN service to replace legacy MPLS across approximately 250 UK sites with resilient dual-carrier architecture, centralised orchestration and embedded security (SASE). SC clearance is mandatory. DXC's existing MOD network footprint and network NOC capability are strong advantages. Teaming with a specialist carrier partner is recommended for SLA credibility. Estimated win probability: HIGH. Bid/no-bid recommendation: PURSUE."
                },
                {
                    t: "MPLS Network Replacement",
                    b: "HMRC",
                    v: "&#163;9.8M",
                    months: "36 months",
                    deadline: { day: "7", mon: "May", urg: "mv-badge-soon", days: "8 days", dc: "mv-days-soon" },
                    tasks: ["Map existing HMRC MPLS topology", "Assess SD-WAN vs private circuit replacement approach", "Coordinate with Workplace offering on shared site visits"],
                    ai: "HMRC is replacing its legacy MPLS WAN with a modern SD-WAN or hybrid private circuit solution across 180 sites. DXC already has presence at HMRC (SOC and Workplace) &mdash; leverage existing site access and relationships to accelerate technical discovery. Coordinate bid with Workplace offering for combined commercial impact. Estimated win probability: MEDIUM-HIGH. Bid/no-bid recommendation: PURSUE."
                },
                {
                    t: "Core Network Services &mdash; NHS",
                    b: "NHS England",
                    v: "&#163;7.2M",
                    months: "30 months",
                    deadline: { day: "15", mon: "May", urg: "mv-badge-ok", days: "16 days", dc: "mv-days-ok" },
                    tasks: ["Review HSCN connectivity requirements", "Confirm DSP Toolkit compliance for network services", "Align with Cloud offering on shared NHS account plan"],
                    ai: "NHS England is procuring core network services including HSCN connectivity, LAN/WAN management and network security monitoring across its estate. DXC's existing HSCN connectivity and NHS footprint are significant assets. Align this pursuit with the Cloud multi-cloud programme for a combined account strategy &mdash; joint commercial proposition reduces NHS supplier complexity. Estimated win probability: HIGH. Bid/no-bid recommendation: PURSUE."
                }
            ]
        }
    };

    function _mvOppHtml(items) {
        return items.map(o => `
            <div class="mv-opp-row">
                <div class="mv-opp-title">${o.t}</div>
                <div class="mv-opp-meta">
                    <span class="mv-opp-buyer">${o.b}</span>
                    <span class="mv-pill ${o.sc}">${o.stage}</span>
                    <span class="mv-pill ${o.srcc}">${o.src}</span>
                    <span class="mv-value-tag">${o.v}</span>
                </div>
            </div>`).join('');
    }

    function _mvBarsHtml(items) {
        return items.map(a => `
            <div class="mv-account-row">
                <div class="mv-account-top">
                    <div class="mv-account-dot" style="background:${a.c};"></div>
                    <div class="mv-account-name">${a.n}</div>
                    <div class="mv-account-count">${a.count}</div>
                </div>
                <div class="mv-account-bar"><div class="mv-account-fill" style="width:${a.pct}%;background:linear-gradient(90deg,${a.grad});"></div></div>
                <div class="mv-account-cpvs">${a.cpvs}</div>
            </div>`).join('');
    }

    function _mvDeadlineHtml(items) {
        return items.map(d => `
            <div class="mv-deadline-row">
                <div class="mv-deadline-badge ${d.urg}"><span class="mv-dd-day">${d.day}</span><span class="mv-dd-mon">${d.mon}</span></div>
                <div class="mv-deadline-info">
                    <div class="mv-deadline-title">${d.t}</div>
                    <div class="mv-deadline-buyer">${d.b}</div>
                </div>
                <div class="mv-deadline-days ${d.dc}">${d.days}</div>
            </div>`).join('');
    }

    function _mvPipelineHtml(items, total) {
        return items.map(p => `
            <div class="mv-pipeline-row">
                <div class="mv-pipeline-dot" style="background:${p.c};"></div>
                <div class="mv-pipeline-name">${p.n}</div>
                <div class="mv-pipeline-value">${p.v}</div>
                <div class="mv-pipeline-bar"><div class="mv-pipeline-fill" style="width:${p.pct}%;background:${p.c};"></div></div>
            </div>`).join('') + `
            <div class="mv-total-row">
                <span class="mv-total-label">Total Pipeline</span>
                <span class="mv-total-value">${total}</span>
            </div>`;
    }

    function setMyView(viewId) {
        const v = MV_VIEWS[viewId];
        if (!v) return;
        const hour = new Date().getHours();
        const g    = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
        const greetEl = document.getElementById("mv-greeting");
        if (greetEl) greetEl.innerHTML = `${g}, ${v.name}.`;
        const subEl = document.getElementById("mv-subtitle");
        if (subEl) subEl.innerHTML = v.subtitle;
        // Stats
        [1,2,3,4].forEach(i => {
            const s = v.stats[i-1];
            const icon  = document.getElementById(`mv-s${i}-icon`);
            const num   = document.getElementById(`mv-s${i}-num`);
            const label = document.getElementById(`mv-s${i}-label`);
            const trend = document.getElementById(`mv-s${i}-trend`);
            if (icon)  icon.innerHTML  = s.icon;
            if (num)   num.innerHTML   = s.num;
            if (label) label.innerHTML = s.label;
            if (trend) { trend.className = `mv-stat-trend${s.trendClass ? ' '+s.trendClass : ''}`; trend.innerHTML = s.trend; }
        });

        // Toggle layout: Bid Manager has own layout; all offerings use shared offering layout; others use standard grid
        const mainGrid    = document.getElementById("mv-main-grid");
        const offLayout   = document.getElementById("mv-offering-layout");
        const bidLayout   = document.getElementById("mv-bidmanager-layout");
        const offeringViews = ["security", "cloud", "workplace", "network"];
        if (offeringViews.includes(viewId)) {
            if (mainGrid)  mainGrid.style.display  = "none";
            if (offLayout) offLayout.style.display = "";
            if (bidLayout) bidLayout.style.display = "none";
            _renderOfferingLayout(viewId, v);
        } else if (viewId === "bidmanager") {
            if (mainGrid)  mainGrid.style.display  = "none";
            if (offLayout) offLayout.style.display = "none";
            if (bidLayout) bidLayout.style.display = "";
            _renderBidManagerLayout(v);
        } else {
            if (mainGrid)  mainGrid.style.display  = "";
            if (offLayout) offLayout.style.display = "none";
            if (bidLayout) bidLayout.style.display = "none";
            // Card headers
            [1,2,3,4].forEach(i => {
                const cfg = v[`b${i}`];
                const ic  = document.getElementById(`mv-b${i}-icon`);
                const tt  = document.getElementById(`mv-b${i}-title`);
                const lk  = document.getElementById(`mv-b${i}-link`);
                if (ic) { ic.innerHTML = cfg.icon; ic.className = `mv-card-icon ${cfg.iconCls}`; }
                if (tt) tt.innerHTML = cfg.title;
                if (lk) {
                    if (cfg.linkText) {
                        lk.innerHTML = cfg.linkText;
                        lk.setAttribute("onclick", `${cfg.linkAction};return false;`);
                        lk.style.display = "";
                    } else {
                        lk.style.display = "none";
                    }
                }
            });
            // Card bodies
            const b1 = document.getElementById("mv-b1-body");
            const b2 = document.getElementById("mv-b2-body");
            const b3 = document.getElementById("mv-b3-body");
            const b4 = document.getElementById("mv-b4-body");
            if (b1) b1.innerHTML = _mvOppHtml(v.opps);
            if (b2) b2.innerHTML = _mvBarsHtml(v.bars);
            if (b3) b3.innerHTML = _mvDeadlineHtml(v.deadlines);
            if (b4) b4.innerHTML = _mvPipelineHtml(v.pipeline, v.total);
        }
    }

    // =====================
    // OFFERING REVIEW QUEUE (Security, Cloud, Workplace, Network)
    // =====================
    const _qualifyState   = {};   // { viewId: { idx: "in"|"out"|null } }
    const _offeringNotes  = {};   // { viewId: { idx: string } }
    let   _currentOffView = "";   // which offering view is currently active

    const _offViewMeta = {
        security:  { icon: "&#128737;", label: "Security",          focus: "Focus Areas",    pipe: "Security Pipeline" },
        cloud:     { icon: "&#9729;",   label: "Cloud",             focus: "Cloud Accounts", pipe: "Cloud Pipeline"    },
        workplace: { icon: "&#128187;", label: "Workplace",         focus: "Focus Areas",    pipe: "Workplace Pipeline"},
        network:   { icon: "&#128268;", label: "Network &amp; Infra",focus: "Focus Areas",   pipe: "Network Pipeline"  }
    };

    function _renderOfferingLayout(viewId, v) {
        _currentOffView = viewId;
        const meta = _offViewMeta[viewId] || {};
        const iconEl  = document.getElementById("mv-off-queue-icon");
        const titleEl = document.getElementById("mv-off-queue-title");
        const focEl   = document.getElementById("mv-off-focus-title");
        const pipEl   = document.getElementById("mv-off-pipeline-title");
        if (iconEl)  iconEl.innerHTML  = meta.icon  || "";
        if (titleEl) titleEl.innerHTML = `${meta.label || ""} &mdash; Opportunities to Review Today`;
        if (focEl)   focEl.innerHTML   = meta.focus  || "Focus Areas";
        if (pipEl)   pipEl.innerHTML   = meta.pipe   || "Pipeline";
        const queueEl = document.getElementById("mv-off-queue-body");
        const focusEl = document.getElementById("mv-off-focus-body");
        const pipeEl  = document.getElementById("mv-off-pipeline-body");
        if (queueEl) queueEl.innerHTML = _renderOfferingQueue(viewId, v.reviewQueue || []);
        if (focusEl) focusEl.innerHTML = _mvBarsHtml(v.bars);
        if (pipeEl)  pipeEl.innerHTML  = _mvPipelineHtml(v.pipeline, v.total);
    }

    const _MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
    function _deadlineSort(items) {
        return items
            .map((o, i) => ({ o, i }))
            .sort((a, b) => {
                const da = parseInt(a.o.deadline.day) + (_MONTHS[a.o.deadline.mon.toLowerCase().slice(0,3)] || 0) * 31;
                const db = parseInt(b.o.deadline.day) + (_MONTHS[b.o.deadline.mon.toLowerCase().slice(0,3)] || 0) * 31;
                return da - db;
            });
    }

    function _renderOfferingQueue(viewId, items) {
        if (!items.length) return `<div style="padding:20px;color:#aaa;font-size:0.85rem;">No opportunities assigned.</div>`;
        if (!_qualifyState[viewId])  _qualifyState[viewId]  = {};
        if (!_offeringNotes[viewId]) _offeringNotes[viewId] = {};
        return _deadlineSort(items).map(({ o, i }) => {
            const state     = _qualifyState[viewId][i];
            const inActive  = state === "in"  ? " active" : "";
            const outActive = state === "out" ? " active" : "";
            const note      = _offeringNotes[viewId][i] || "";
            const noteText  = `<textarea class="mv-queue-note-inline" id="mv-off-note-${i}" data-idx="${i}" placeholder="Add notes..." oninput="offeringSaveNote(this)">${note.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</textarea>`;
            return `
            <div class="mv-queue-item" id="mv-off-q-${i}">
                <div class="mv-queue-deadline">
                    <div class="mv-deadline-badge ${o.deadline.urg}">
                        <span class="mv-dd-day">${o.deadline.day}</span>
                        <span class="mv-dd-mon">${o.deadline.mon}</span>
                    </div>
                </div>
                <div class="mv-queue-main">
                    <div class="mv-queue-title">${o.t}</div>
                    <div class="mv-queue-meta">
                        <span class="mv-opp-buyer">${o.b}</span>
                        <span class="mv-value-tag">${o.v}</span>
                        <span class="mv-pill mv-pill-blue">${o.months}</span>
                        <span class="mv-deadline-days ${o.deadline.dc}">${o.deadline.days}</span>
                    </div>
                    <div class="mv-queue-tasks">
                        ${o.tasks.map(t => `<span class="mv-task-item">${t}</span>`).join("")}
                    </div>
                    <div class="mv-queue-score-row">
                        ${(()=>{ const _v = parseFloat((o.v||'').replace(/[^0-9.]/g,'')||'0') * (o.v&&o.v.includes('M')?1_000_000:1); const _o = {buyer:o.b,value:_v,cpvs:'',title:o.t,description:''}; return routingBadgeHtml(classifyOpp(_o)) + (placeholderScore(_o)?scoreBadgeHtml(placeholderScore(_o)):''); })()}
                    </div>
                    ${o.ai ? `<div class="mv-queue-ai-teaser"><span class="mv-queue-ai-teaser-icon">&#9889;</span><span class="mv-queue-ai-teaser-text">${o.ai.substring(0, 160)}${o.ai.length > 160 ? "&hellip;" : ""}</span>${o.ai.length > 160 ? ` <button class="read-more-btn" data-desc="${o.ai.replace(/"/g,'&quot;')}" data-html="1" onclick="showDescPopup(this)">Read more</button>` : ""}</div>` : ""}
                </div>
                <div class="mv-queue-note-col">${noteText}</div>
                <div class="mv-queue-actions">
                    <button class="mv-qualify-in${inActive}"  onclick="offeringQualify(${i},'in')">Qualify In &#10003;</button>
                    <button class="mv-qualify-out${outActive}" onclick="offeringQualify(${i},'out')">Qualify Out &#10007;</button>
                    <button class="mv-queue-view-btn" onclick="offeringOpenFullscreen(${i})">View &#8599;</button>
                </div>
            </div>`;
        }).join("");
    }

    function offeringQualify(idx, decision) {
        const vid = _currentOffView;
        if (!_qualifyState[vid]) _qualifyState[vid] = {};
        _qualifyState[vid][idx] = _qualifyState[vid][idx] === decision ? null : decision;
        const state = _qualifyState[vid][idx];
        const row = document.getElementById(`mv-off-q-${idx}`);
        if (row) {
            row.querySelector(".mv-qualify-in").className  = `mv-qualify-in${state === "in"  ? " active" : ""}`;
            row.querySelector(".mv-qualify-out").className = `mv-qualify-out${state === "out" ? " active" : ""}`;
        }
        const fsActions = document.getElementById("mv-off-fs-actions");
        if (fsActions && fsActions.dataset.idx == idx) _offSyncFsButtons(idx);
    }

    function offeringOpenFullscreen(idx) {
        const vid = _currentOffView;
        const o = (MV_VIEWS[vid] && MV_VIEWS[vid].reviewQueue || [])[idx];
        if (!o) return;
        document.getElementById("mv-off-fs-title").innerHTML = o.t;
        document.getElementById("mv-off-fs-meta").innerHTML = `
            <div class="mv-sec-fs-meta-item"><div class="mv-sec-fs-meta-lbl">Buyer</div><div class="mv-sec-fs-meta-val">${o.b}</div></div>
            <div class="mv-sec-fs-meta-item"><div class="mv-sec-fs-meta-lbl">TCV</div><div class="mv-sec-fs-meta-val">${o.v}</div></div>
            <div class="mv-sec-fs-meta-item"><div class="mv-sec-fs-meta-lbl">Length</div><div class="mv-sec-fs-meta-val">${o.months}</div></div>
            <div class="mv-sec-fs-meta-item"><div class="mv-sec-fs-meta-lbl">Deadline</div><div class="mv-sec-fs-meta-val">${o.deadline.day} ${o.deadline.mon} &middot; ${o.deadline.days}</div></div>`;
        document.getElementById("mv-off-fs-ai").innerHTML = o.ai;
        document.getElementById("mv-off-fs-tasks").innerHTML = o.tasks.map(t => `<div class="mv-sec-fs-task">${t}</div>`).join("");
        const fsActions = document.getElementById("mv-off-fs-actions");
        fsActions.dataset.idx = idx;
        _offSyncFsButtons(idx);
        if (!_offeringNotes[vid]) _offeringNotes[vid] = {};
        const notesEl = document.getElementById("mv-off-fs-notes");
        if (notesEl) { notesEl.value = _offeringNotes[vid][idx] || ""; notesEl.dataset.idx = idx; }
        document.getElementById("mv-off-fullscreen").classList.remove("hidden");
    }

    function offeringSaveNote(el) {
        const vid = _currentOffView;
        const idx = parseInt(el.dataset.idx);
        if (!_offeringNotes[vid]) _offeringNotes[vid] = {};
        _offeringNotes[vid][idx] = el.value;
        if (el.id === "mv-off-fs-notes") {
            const inline = document.getElementById(`mv-off-note-${idx}`);
            if (inline && inline !== el) inline.value = el.value;
        } else {
            const fsNotes = document.getElementById("mv-off-fs-notes");
            if (fsNotes && parseInt(fsNotes.dataset.idx) === idx) fsNotes.value = el.value;
        }
    }

    function _offSyncFsButtons(idx) {
        const state = (_qualifyState[_currentOffView] || {})[idx];
        const fsActions = document.getElementById("mv-off-fs-actions");
        if (!fsActions) return;
        fsActions.innerHTML = `
            <button class="mv-qualify-in${state==="in"?" active":""}"  onclick="offeringQualify(${idx},'in')">Qualify In &#10003;</button>
            <button class="mv-qualify-out${state==="out"?" active":""}" onclick="offeringQualify(${idx},'out')">Qualify Out &#10007;</button>`;
        fsActions.dataset.idx = idx;
    }

    function closeMvOffFs() {
        document.getElementById("mv-off-fullscreen").classList.add("hidden");
    }

    // =====================
    // BID MANAGER PURSUITS
    // =====================
    const _bidNotes  = {};
    const _bidSfdc   = {};
    const _bidLoopio = {};

    function _renderBidManagerLayout(v) {
        const pursEl  = document.getElementById("mv-bid-pursuits-body");
        const acctsEl = document.getElementById("mv-bid-accts-body");
        const pipeEl  = document.getElementById("mv-bid-pipe-body");
        if (pursEl)  pursEl.innerHTML  = _renderBidPursuits(v.pursuits || []);
        if (acctsEl) acctsEl.innerHTML = _mvBarsHtml(v.bars);
        if (pipeEl)  pipeEl.innerHTML  = _mvPipelineHtml(v.pipeline, v.total);
    }

    function _teamPillHtml(ts) {
        const map = { in: "mv-team-pill--in", out: "mv-team-pill--out", pending: "mv-team-pill--pending", na: "mv-team-pill--na" };
        const icons = { in: "&#10003;", out: "&#10007;", pending: "&#8635;", na: "&mdash;" };
        const cls  = map[ts.state]   || "mv-team-pill--na";
        const icon = icons[ts.state] || "&mdash;";
        return `<span class="mv-team-pill ${cls}" title="${ts.note}">${icon} ${ts.offering}</span>`;
    }

    function _renderBidPursuits(items) {
        if (!items.length) return `<div style="padding:20px;color:#aaa;font-size:0.85rem;">No active pursuits.</div>`;
        return _deadlineSort(items).map(({ o, i }) => {
            const sfdcDone   = !!_bidSfdc[i];
            const loopioDone = !!_bidLoopio[i];
            const bidNote    = _bidNotes[i] || "";
            const noteText   = `<textarea class="mv-queue-note-inline" id="mv-bid-note-${i}" data-idx="${i}" placeholder="Add notes..." oninput="bidSaveNote(this)">${bidNote.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</textarea>`;
            return `
            <div class="mv-queue-item" id="mv-bid-p-${i}">
                <div class="mv-queue-deadline">
                    <div class="mv-deadline-badge ${o.deadline.urg}">
                        <span class="mv-dd-day">${o.deadline.day}</span>
                        <span class="mv-dd-mon">${o.deadline.mon}</span>
                    </div>
                </div>
                <div class="mv-queue-main">
                    <div class="mv-queue-title">${o.t}</div>
                    <div class="mv-queue-meta">
                        <span class="mv-opp-buyer">${o.b}</span>
                        <span class="mv-value-tag">${o.v}</span>
                        <span class="mv-pill mv-pill-blue">${o.months}</span>
                        <span class="mv-bid-status ${o.statusCls}">${o.status}</span>
                        <span class="mv-deadline-days ${o.deadline.dc}">${o.deadline.days}</span>
                    </div>
                    <div class="mv-team-status-row">
                        ${o.teamStatus.map(_teamPillHtml).join("")}
                    </div>
                    ${o.ai ? `<div class="mv-queue-ai-teaser"><span class="mv-queue-ai-teaser-icon">&#9889;</span><span class="mv-queue-ai-teaser-text">${o.ai.substring(0, 160)}${o.ai.length > 160 ? "&hellip;" : ""}</span>${o.ai.length > 160 ? ` <button class="read-more-btn" data-desc="${o.ai.replace(/"/g,'&quot;')}" data-html="1" onclick="showDescPopup(this)">Read more</button>` : ""}</div>` : ""}
                </div>
                <div class="mv-queue-note-col">${noteText}</div>
                <div class="mv-queue-actions">
                    <button class="mv-sfdc-btn${sfdcDone?" done":""}"   onclick="bidSfdc(${i})">${sfdcDone   ? "Loaded &#10003;"   : "Load into SFDC"}</button>
                    <button class="mv-loopio-btn${loopioDone?" done":""}" onclick="bidLoopio(${i})">${loopioDone ? "Sent &#10003;" : "Send to Loopio"}</button>
                    <button class="mv-queue-view-btn" onclick="bidOpenFullscreen(${i})">View &#8599;</button>
                </div>
            </div>`;
        }).join("");
    }

    function bidSfdc(idx) {
        _bidSfdc[idx] = !_bidSfdc[idx];
        const btn = document.querySelector(`#mv-bid-p-${idx} .mv-sfdc-btn`);
        if (btn) { btn.className = `mv-sfdc-btn${_bidSfdc[idx]?" done":""}`; btn.innerHTML = _bidSfdc[idx] ? "Loaded &#10003;" : "Load into SFDC"; }
        const fsbtn = document.getElementById("mv-bid-fs-sfdc");
        if (fsbtn) { fsbtn.className = `mv-sfdc-btn${_bidSfdc[idx]?" done":""}`; fsbtn.innerHTML = _bidSfdc[idx] ? "Loaded &#10003;" : "Load into SFDC"; }
    }

    function bidLoopio(idx) {
        _bidLoopio[idx] = !_bidLoopio[idx];
        const btn = document.querySelector(`#mv-bid-p-${idx} .mv-loopio-btn`);
        if (btn) { btn.className = `mv-loopio-btn${_bidLoopio[idx]?" done":""}`; btn.innerHTML = _bidLoopio[idx] ? "Sent &#10003;" : "Send to Loopio"; }
        const fsbtn = document.getElementById("mv-bid-fs-loopio");
        if (fsbtn) { fsbtn.className = `mv-loopio-btn${_bidLoopio[idx]?" done":""}`; fsbtn.innerHTML = _bidLoopio[idx] ? "Sent &#10003;" : "Send to Loopio"; }
    }

    function bidOpenFullscreen(idx) {
        const o = (MV_VIEWS.bidmanager.pursuits || [])[idx];
        if (!o) return;
        document.getElementById("mv-bid-fs-title").innerHTML = o.t;
        document.getElementById("mv-bid-fs-meta").innerHTML = `
            <div class="mv-sec-fs-meta-item"><div class="mv-sec-fs-meta-lbl">Buyer</div><div class="mv-sec-fs-meta-val">${o.b}</div></div>
            <div class="mv-sec-fs-meta-item"><div class="mv-sec-fs-meta-lbl">TCV</div><div class="mv-sec-fs-meta-val">${o.v}</div></div>
            <div class="mv-sec-fs-meta-item"><div class="mv-sec-fs-meta-lbl">Length</div><div class="mv-sec-fs-meta-val">${o.months}</div></div>
            <div class="mv-sec-fs-meta-item"><div class="mv-sec-fs-meta-lbl">Deadline</div><div class="mv-sec-fs-meta-val">${o.deadline.day} ${o.deadline.mon} &middot; ${o.deadline.days}</div></div>
            <div class="mv-sec-fs-meta-item"><div class="mv-sec-fs-meta-lbl">Status</div><div class="mv-sec-fs-meta-val"><span class="mv-bid-status ${o.statusCls}">${o.status}</span></div></div>`;
        document.getElementById("mv-bid-fs-ai").innerHTML = o.ai;
        const stateMap = { in: "mv-team-state--in", out: "mv-team-state--out", pending: "mv-team-state--pending", na: "mv-team-state--na" };
        const labelMap = { in: "&#10003; Qualified In", out: "&#10007; Qualified Out", pending: "&#8635; Awaiting Input", na: "&mdash; Not Applicable" };
        document.getElementById("mv-bid-fs-team").innerHTML = `<div class="mv-team-detail-list">${
            o.teamStatus.map(ts => `
            <div class="mv-team-detail-row">
                <div class="mv-team-detail-offering">${ts.offering}</div>
                <div class="mv-team-detail-state ${stateMap[ts.state]||""}">${labelMap[ts.state]||ts.state}</div>
                <div class="mv-team-detail-note">${ts.note}</div>
            </div>`).join("")
        }</div>`;
        const notesEl = document.getElementById("mv-bid-fs-notes");
        if (notesEl) { notesEl.value = _bidNotes[idx] || ""; notesEl.dataset.idx = idx; }
        document.getElementById("mv-bid-fs-actions").innerHTML = `
            <button class="mv-sfdc-btn${_bidSfdc[idx]?" done":""}" id="mv-bid-fs-sfdc" onclick="bidSfdc(${idx})">${_bidSfdc[idx]?"Loaded &#10003;":"Load into SFDC"}</button>
            <button class="mv-loopio-btn${_bidLoopio[idx]?" done":""}" id="mv-bid-fs-loopio" onclick="bidLoopio(${idx})">${_bidLoopio[idx]?"Sent &#10003;":"Send to Loopio"}</button>`;
        document.getElementById("mv-bid-fs-actions").dataset.idx = idx;
        document.getElementById("mv-bid-fullscreen").classList.remove("hidden");
    }

    function bidSaveNote(el) {
        const idx = parseInt(el.dataset.idx);
        _bidNotes[idx] = el.value;
        if (el.id === "mv-bid-fs-notes") {
            const inline = document.getElementById(`mv-bid-note-${idx}`);
            if (inline && inline !== el) inline.value = el.value;
        } else {
            const fsNotes = document.getElementById("mv-bid-fs-notes");
            if (fsNotes && parseInt(fsNotes.dataset.idx) === idx) fsNotes.value = el.value;
        }
    }

    function closeMvBidFs() {
        document.getElementById("mv-bid-fullscreen").classList.add("hidden");
    }

    // =====================
    // SOURCE SWITCHER
    // =====================
    function switchSource(src) {
        activeSource = src;
        document.querySelectorAll(".source-pill").forEach(p => p.classList.remove("active"));
        document.getElementById("src-" + src).classList.add("active");

        // Load button adapts to the active source
        const loadBtn    = document.getElementById("loadBtn");
        const loadStatus = document.getElementById("load-status");
        loadBtn.style.display    = "";
        loadStatus.style.display = "";
        const labels = {
            fat: "Load today's opportunities",
            cf:  "Load Contracts Finder",
            pcs: "Load Public Contracts Scotland",
        };
        loadBtn.textContent = labels[src];
        loadBtn.onclick = src === "fat" ? loadOpportunities
                        : src === "cf"  ? loadContractsFinder
                        :                 loadPcsData;

        // Show the correct filter panel
        document.querySelectorAll(".source-filters").forEach(f => f.style.display = "none");
        document.getElementById("filters-" + src).style.display = "";
        fetchAndRender();
    }

    // =====================
    // LOAD
    // =====================
    function _startLoadTimer(status, stages) {
        const t0 = Date.now();
        const bar = document.getElementById("load-bar");
        const wrap = document.getElementById("load-bar-wrap");
        if (wrap) wrap.style.display = "block";
        if (bar)  bar.style.width = "0%";
        // Animate bar to 90% over ~40s (never reaches 100 until done)
        const tick = setInterval(() => {
            const elapsed = Math.round((Date.now() - t0) / 1000);
            const pct = Math.min(90, (elapsed / 40) * 100);
            if (bar) bar.style.width = pct + "%";
            const s = stages[Math.min(Math.floor(elapsed / 8), stages.length - 1)];
            status.textContent = `${s} (${elapsed}s)`;
        }, 800);
        return {
            clear: () => {
                clearInterval(tick);
                if (bar)  { bar.style.width = "100%"; setTimeout(() => { bar.style.width="0%"; if(wrap) wrap.style.display="none"; }, 600); }
            },
            elapsed: () => Math.round((Date.now() - t0) / 1000),
        };
    }

    async function loadOpportunities(daysBack) {
        const btn    = document.getElementById("loadBtn");
        const status = document.getElementById("load-status");
        const days   = daysBack || 2;
        btn.disabled = true;
        btn.textContent = days > 2 ? `Loading last ${days} days…` : "Loading…";
        status.textContent = "";
        const stages = [
            "Connecting to Find a Tender…",
            "Fetching notices (page 1)…",
            "Fetching notices (page 2)…",
            "Saving new records to database…",
        ];
        const timer = _startLoadTimer(status, stages);
        try {
            const resp = await fetch(`/load?days_back=${days}`, { method: "POST" });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.detail || `HTTP ${resp.status}`);
            const elapsed = timer.elapsed();
            status.textContent = `✓ ${data.new_saved} new · ${data.total_fetched} fetched · ${elapsed}s`;
        } catch(e) {
            status.textContent = `⚠ Load failed: ${e.message}`;
        } finally {
            timer.clear();
            btn.disabled = false;
            btn.textContent = "Load today's opportunities";
        }
        await fetchAndRender();
    }

    async function loadContractsFinder() {
        const btn    = document.getElementById("loadBtn");
        const status = document.getElementById("load-status");
        btn.disabled = true;
        btn.textContent = "Loading…";
        status.textContent = "";
        const stages = [
            "Connecting to Contracts Finder…",
            "Fetching planning notices…",
            "Fetching tender notices…",
            "Saving new records to database…",
        ];
        const timer = _startLoadTimer(status, stages);
        try {
            const resp = await fetch("/load/contracts-finder", { method: "POST" });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.detail || `HTTP ${resp.status}`);
            status.textContent = `✓ ${data.new_saved} new · ${data.total_fetched} fetched · ${timer.elapsed()}s`;
        } catch(e) {
            status.textContent = `⚠ Load failed: ${e.message}`;
        } finally {
            timer.clear();
            btn.disabled = false;
            btn.textContent = "Load Contracts Finder";
        }
        await fetchAndRender();
    }

    async function loadPcsData() {
        const btn    = document.getElementById("loadBtn");
        const status = document.getElementById("load-status");
        btn.disabled = true;
        btn.textContent = "Loading…";
        status.textContent = "";
        const stages = [
            "Connecting to Public Contracts Scotland…",
            "Fetching this month's notices…",
            "Fetching last month's notices…",
            "Saving new records to database…",
        ];
        const timer = _startLoadTimer(status, stages);
        try {
            const resp = await fetch("/load/pcs", { method: "POST" });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.detail || `HTTP ${resp.status}`);
            status.textContent = `✓ ${data.new_saved} new · ${data.total_fetched} fetched · ${timer.elapsed()}s`;
        } catch(e) {
            status.textContent = `⚠ Load failed: ${e.message}`;
        } finally {
            timer.clear();
            btn.disabled = false;
            btn.textContent = "Load Public Contracts Scotland";
        }
        await fetchAndRender();
    }

    async function backfillContractMonths() {
        const btn    = document.getElementById("backfill-btn");
        const status = document.getElementById("backfill-status");
        btn.disabled = true;
        status.textContent = "Fetching from API — may take a minute…";
        try {
            const resp = await fetch("/backfill/contract-months", { method: "POST" });
            const data = await resp.json();
            status.textContent = `✓ Updated ${data.updated} record(s)`;
            if (data.updated > 0) await fetchAndRender();
        } catch {
            status.textContent = "⚠ Backfill failed";
        } finally {
            btn.disabled = false;
        }
    }

    async function backfillSuppliers() {
        const btn    = document.getElementById("backfill-suppliers-btn");
        const status = document.getElementById("backfill-suppliers-status");
        btn.disabled = true;
        status.textContent = "Fetching from API — may take a minute…";
        try {
            const resp = await fetch("/backfill/awarded-suppliers", { method: "POST" });
            const data = await resp.json();
            status.textContent = `✓ Updated ${data.updated} record(s)`;
            if (data.updated > 0) await fetchAndRender();
        } catch {
            status.textContent = "⚠ Backfill failed";
        } finally {
            btn.disabled = false;
        }
    }

    // =====================
    // FILTER PARAM BUILDERS
    // =====================
    function buildFatParams() {
        const p = new URLSearchParams();
        const kw = document.getElementById("f-keyword").value.trim();
        if (kw) p.set("keyword", kw);
        const cpv = document.getElementById("f-cpv").value.trim();
        if (cpv) p.set("cpv_prefixes", cpv);
        const minV = document.getElementById("f-min").value;
        if (minV) p.set("min_value", minV);
        const maxV = document.getElementById("f-max").value;
        if (maxV) p.set("max_value", maxV);
        const stages = [...document.querySelectorAll("#stage-checkboxes input:checked")].map(cb => cb.value);
        if (stages.length) p.set("stages", stages.join(","));
        const buyer = document.getElementById("f-buyer").value.trim();
        if (buyer) p.set("buyer", buyer);
        const df = document.getElementById("f-date-from").value;
        if (df) p.set("date_from", df);
        const dt = document.getElementById("f-date-to").value;
        if (dt) p.set("date_to", dt);
        if (document.getElementById("f-framework-only")?.checked) p.set("framework_only", "true");
        return p;
    }

    function buildCfParams() {
        const p = new URLSearchParams();
        const kw = document.getElementById("cf-keyword").value.trim();
        if (kw) p.set("keyword", kw);
        const cpv = document.getElementById("cf-cpv").value.trim();
        if (cpv) p.set("cpv_prefixes", cpv);
        const minV = document.getElementById("cf-min").value;
        if (minV) p.set("min_value", minV);
        const maxV = document.getElementById("cf-max").value;
        if (maxV) p.set("max_value", maxV);
        const stages = ["planning","tender","award","contract"]
            .filter(s => document.getElementById("cf-stage-" + s)?.checked);
        if (stages.length) p.set("stages", stages.join(","));
        const buyer = document.getElementById("cf-buyer").value.trim();
        if (buyer) p.set("buyer", buyer);
        // "Display period" select → compute date_from; manual date picker overrides it
        const manualDf = document.getElementById("cf-date-from").value;
        if (manualDf) {
            p.set("date_from", manualDf);
        } else {
            const daysBack = parseInt(document.getElementById("cf-days-back").value, 10);
            const d = new Date();
            d.setDate(d.getDate() - (daysBack - 1));
            p.set("date_from", d.toISOString().substring(0, 10));
        }
        const dt = document.getElementById("cf-date-to").value;
        if (dt) p.set("date_to", dt);
        return p;
    }

    function buildPcsParams() {
        const p = new URLSearchParams();
        const kw = document.getElementById("pcs-keyword").value.trim();
        if (kw) p.set("keyword", kw);
        const cpv = document.getElementById("pcs-cpv").value.trim();
        if (cpv) p.set("cpv_prefixes", cpv);
        const minV = document.getElementById("pcs-min").value;
        if (minV) p.set("min_value", minV);
        const maxV = document.getElementById("pcs-max").value;
        if (maxV) p.set("max_value", maxV);
        // Notice type checkboxes → map to OCDS stage tags for post-filter
        const stageMap = { 1: "tender", 4: "planning", 5: "award" };
        const selectedStages = [1,4,5]
            .filter(t => document.getElementById("pcs-type-" + t)?.checked)
            .map(t => stageMap[t]);
        // Only send stages filter when it's a true subset (all checked = no filter needed)
        if (selectedStages.length > 0 && selectedStages.length < 3) {
            p.set("stages", selectedStages.join(","));
        }
        const buyer = document.getElementById("pcs-buyer").value.trim();
        if (buyer) p.set("buyer", buyer);
        // "Display period" select → compute date_from; manual date picker overrides it
        const manualDf = document.getElementById("pcs-date-from").value;
        if (manualDf) {
            p.set("date_from", manualDf);
        } else {
            const monthsBack = parseInt(document.getElementById("pcs-months-back").value, 10);
            const d = new Date();
            d.setMonth(d.getMonth() - monthsBack);
            p.set("date_from", d.toISOString().substring(0, 10));
        }
        const dt = document.getElementById("pcs-date-to").value;
        if (dt) p.set("date_to", dt);
        return p;
    }

    function clearCfFilters() {
        ["cf-keyword","cf-cpv","cf-min","cf-max","cf-buyer","cf-date-from","cf-date-to"]
            .forEach(id => document.getElementById(id).value = "");
        ["planning","tender","award","contract"].forEach(s => {
            const el = document.getElementById("cf-stage-" + s);
            if (el) el.checked = (s === "planning" || s === "tender");
        });
        document.getElementById("cf-days-back").value = "7";
        fetchAndRender();
    }

    function clearPcsFilters() {
        ["pcs-keyword","pcs-cpv","pcs-min","pcs-max","pcs-buyer","pcs-date-from","pcs-date-to"]
            .forEach(id => document.getElementById(id).value = "");
        [1,4,5].forEach(t => {
            const el = document.getElementById("pcs-type-" + t);
            if (el) el.checked = true;
        });
        document.getElementById("pcs-months-back").value = "2";
        fetchAndRender();
    }

    // =====================
    // FETCH & RENDER
    // =====================
    async function fetchAndRender() {
        const params = activeSource === "fat" ? buildFatParams()
                     : activeSource === "cf"  ? buildCfParams()
                     :                         buildPcsParams();

        const liveMsg = activeSource !== "fat"
            ? "Fetching from saved data…"
            : "Fetching…";
        document.getElementById("table-container").innerHTML =
            `<div class="empty-state"><span class="spinner"></span>${liveMsg}</div>`;

        try {
            if (activeSource === "fat") {
                const [oppResp, batchResp] = await Promise.all([
                    fetch("/opportunities?" + params.toString()),
                    fetch("/batches"),
                ]);
                const data      = await oppResp.json();
                const batchData = await batchResp.json();
                batchMeta   = batchData;
                currentData = data;
                populateStages(data);
                renderTable(data);
            } else {
                const endpoint     = activeSource === "cf"
                    ? "/live/contracts-finder?" + params.toString()
                    : "/live/pcs?" + params.toString();
                const batchEndpoint = activeSource === "cf"
                    ? "/batches/contracts-finder"
                    : "/batches/pcs";
                const [oppResp, batchResp] = await Promise.all([
                    fetch(endpoint),
                    fetch(batchEndpoint),
                ]);
                const data      = await oppResp.json();
                const batchData = await batchResp.json();
                batchMeta   = batchData;
                currentData = data;
                renderTable(data);
            }
        } catch {
            document.getElementById("table-container").innerHTML =
                `<div class="empty-state">⚠ Error fetching data.</div>`;
        }
    }

    // =====================
    // AWARDED IT PRESET
    // =====================
    async function fetchAndRenderAwards() {
        const params = new URLSearchParams();
        params.set("cpv_prefixes", "72,30,48");
        params.set("stages", "award,awardUpdate,contract,contractUpdate");

        document.getElementById("awards-table-container").innerHTML =
            `<div class="empty-state"><span class="spinner"></span>Fetching…</div>`;

        try {
            const resp = await fetch("/opportunities?" + params.toString());
            const data = await resp.json();
            awardsData = data;
            renderAwardsTable(data);
        } catch {
            document.getElementById("awards-table-container").innerHTML =
                `<div class="empty-state">⚠ Error fetching data.</div>`;
        }
    }

    function renderAwardsTable(data) {
        const order = document.getElementById("awards-sort-select").value;
        const sorted = [...data].sort((a, b) => {
            switch (order) {
                case "date-asc":   return (a.published_date || "").localeCompare(b.published_date || "");
                case "date-desc":  return (b.published_date || "").localeCompare(a.published_date || "");
                case "value-desc": return (parseFloat(b.value) || 0) - (parseFloat(a.value) || 0);
                case "value-asc":  return (parseFloat(a.value) || 0) - (parseFloat(b.value) || 0);
                case "title-asc":  return (a.title || "").localeCompare(b.title || "");
                default:           return 0;
            }
        });

        document.getElementById("awards-result-count").textContent =
            `${sorted.length} award${sorted.length === 1 ? "" : "s"}`;

        if (!sorted.length) {
            document.getElementById("awards-table-container").innerHTML =
                `<div class="empty-state">No awarded contracts found for CPV prefixes 72, 30, 48.</div>`;
            return;
        }

        const fmt = v => { const n = parseFloat(v); return isNaN(n) ? "—" : "£" + n.toLocaleString("en-GB"); };

        const rows = sorted.map(o => {
            const id = String(o.id);
            const stages = (o.stage || "").split(",").filter(Boolean)
                .map(s => `<span>${esc(s.trim())}</span>`).join("");
            return `
            <tr>
                <td>${o.source_url
                    ? `<a href="${esc(o.source_url)}" target="_blank" rel="noopener">${esc(o.title || "—")}</a>`
                    : esc(o.title || "—")}</td>
                <td>${esc(o.buyer || "—")}</td>
                <td class="value">${fmt(o.value)}</td>
                <td class="stage">${stages}</td>
                <td class="fw-cell">${buildFwCell(o.framework)}</td>
                <td class="cpv">${buildCpvCell(o.cpvs)}</td>
                <td class="supplier-cell">${esc(o.awarded_supplier || "—")}</td>
                <td class="desc" style="min-width:120px;max-width:220px;">
                    <div class="desc-clamp">${esc(o.description || "")}</div>
                    ${o.description ? `<button class="read-more-btn" data-desc="${esc(o.description)}" onclick="showDescPopup(this)">Read more</button>` : ""}
                </td>
                <td class="date-cell">
                    <div><span class="meta-lbl">Published</span>${fmtDate(o.published_date)}</div>
                    ${o.date_modified && o.date_modified.substring(0,16) !== (o.published_date||"").substring(0,16)
                        ? `<div class="date-modified"><span class="meta-lbl">Modified</span>${fmtDate(o.date_modified)}</div>`
                        : ""}
                    ${fmtContract(o.contract_start, o.contract_end)
                        ? `<div style="margin-top:2px;"><span class="meta-lbl">Contract</span>${fmtContract(o.contract_start, o.contract_end)}</div>`
                        : ""}
                </td>
                <td class="term-cell">${contractMonths(o.contract_months, o.contract_start, o.contract_end)}</td>
            </tr>`;
        }).join("");

        document.getElementById("awards-table-container").innerHTML = `
        <table>
            <thead><tr>
                <th>Title</th><th>Buyer</th><th>Value</th>
                <th>Stage</th><th>FW</th><th>CPVs</th><th>Awarded Supplier</th><th>Description</th><th>Dates</th><th>Term</th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>`;

    }

    // =====================
    // SORT
    // =====================
    function sortData(data) {
        const order = document.getElementById("sort-select").value;
        const copy = [...data];
        copy.sort((a, b) => {
            switch (order) {
                case "date-asc":    return (a.published_date || "").localeCompare(b.published_date || "");
                case "date-desc":   return (b.published_date || "").localeCompare(a.published_date || "");
                case "value-desc":  return (parseFloat(b.value) || 0) - (parseFloat(a.value) || 0);
                case "value-asc":   return (parseFloat(a.value) || 0) - (parseFloat(b.value) || 0);
                case "title-asc":   return (a.title || "").localeCompare(b.title || "");
                default:            return 0;
            }
        });
        return copy;
    }

    // =====================
    // RENDER TABLE
    // =====================
    function renderTable(data) {
        const filtered = _routeFilter.size
            ? data.filter(o => _routeFilter.has(classifyOpp(o)))
            : data;
        sortedData  = sortData(filtered);
        currentPage = 1;
        document.getElementById("result-count").textContent =
            `${sortedData.length} opportunit${sortedData.length === 1 ? "y" : "ies"}`;
        renderPage();
    }

    function renderPage() {
        const data = sortedData;
        const pgBar = document.getElementById("pagination-bar");

        if (!data.length) {
            document.getElementById("table-container").innerHTML =
                `<div class="empty-state">No opportunities match the current filters.</div>`;
            pgBar.innerHTML = "";
            return;
        }

        const fmt             = v => { const n = parseFloat(v); return isNaN(n) ? "—" : "£" + n.toLocaleString("en-GB"); };
        const activeBatchId   = batchMeta.active_batch_id   || null;
        const lastSeenBatchId = batchMeta.last_seen_batch_id || null;
        const lastSeenBatch   = (batchMeta.batches || []).find(b => b.batch_id === lastSeenBatchId);
        const activeBatch     = (batchMeta.batches || []).find(b => b.batch_id === activeBatchId);

        // Show "last updated" in toolbar
        const updEl = document.getElementById("last-updated-text");
        if (updEl && activeBatch) {
            const d = new Date(activeBatch.created_at);
            const dayShort = d.toLocaleDateString("en-GB", { weekday: "short" });
            updEl.textContent = `List last updated ${dayShort}, ${activeBatch.label}`;
        } else if (updEl) {
            updEl.textContent = "";
        }

        // Two zones: new = batch_id strictly after last-seen; old = everything else
        const isNew   = o => !!(lastSeenBatchId && o.batch_id && o.batch_id > lastSeenBatchId);
        const newRows = data.filter(isNew);
        const oldRows = data.filter(o => !isNew(o));

        // Pagination
        const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
        currentPage = Math.max(1, Math.min(currentPage, totalPages));
        const start = (currentPage - 1) * PAGE_SIZE;
        const end   = Math.min(start + PAGE_SIZE, data.length);

        // Combined ordered array (new first, then old) — slice for current page
        const combined  = [...newRows, ...oldRows];
        const pageSlice = combined.slice(start, end);

        // Divider falls at index newRows.length in combined[]
        const dividerAt  = newRows.length;
        const showDivider = lastSeenBatch && oldRows.length > 0
            && dividerAt > start && dividerAt <= end;

        // Split page slice into new/old segments
        const newOnPage = Math.max(0, Math.min(dividerAt, end) - start);
        const pageNewRows = pageSlice.slice(0, newOnPage);
        const pageOldRows = pageSlice.slice(newOnPage);

        const renderRow = (o) => {
            const id = String(o.id);
            const isChecked = selected.has(id);
            const stages = (o.stage || "").split(",").filter(Boolean)
                .map(s => `<span>${esc(s.trim())}</span>`).join("");
            const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(o))));
            const rowClasses = [
                isChecked                    ? "selected-row"      : "",
                o.batch_id === activeBatchId ? "row--active-batch" : "",
            ].filter(Boolean).join(" ");

            return `
            <tr class="${rowClasses}" id="row-${id}">
                <td><input type="checkbox" data-id="${id}" data-opp="${encoded}"
                    ${isChecked ? "checked" : ""} onchange="toggleSelected(this)"></td>
                <td>${o.source_url
                    ? `<a href="${esc(o.source_url)}" target="_blank" rel="noopener">${esc(o.title || "—")}</a>`
                    : esc(o.title || "—")}</td>
                <td>${esc(o.buyer || "—")}</td>
                <td class="value">${fmt(o.value)}</td>
                <td class="stage">${stages}</td>
                <td class="fw-cell">${buildFwCell(o.framework)}</td>
                <td class="cpv">${buildCpvCell(o.cpvs)}</td>
                <td class="supplier-cell">${esc(o.awarded_supplier || "—")}</td>
                <td class="desc" style="min-width:120px;max-width:220px;">
                    <div class="desc-clamp">${esc(o.description || "")}</div>
                    ${o.description ? `<button class="read-more-btn" data-desc="${esc(o.description)}" onclick="showDescPopup(this)">Read more</button>` : ""}
                </td>
                <td class="date-cell">
                    <div><span class="meta-lbl">Published</span>${fmtDate(o.published_date)}</div>
                    ${o.date_modified && o.date_modified.substring(0,16) !== (o.published_date||"").substring(0,16)
                        ? `<div class="date-modified"><span class="meta-lbl">Modified</span>${fmtDate(o.date_modified)}</div>`
                        : ""}
                    ${fmtContract(o.contract_start, o.contract_end)
                        ? `<div style="margin-top:2px;"><span class="meta-lbl">Contract</span>${fmtContract(o.contract_start, o.contract_end)}</div>`
                        : ""}
                </td>
                <td class="term-cell">${contractMonths(o.contract_months, o.contract_start, o.contract_end)}</td>
                <td style="white-space:nowrap;">${routingBadgeHtml(classifyOpp(o))}${scoreBadgeHtml(placeholderScore(o))}</td>
            </tr>`;
        };

        // Divider banner
        let dividerHtml = "";
        if (showDivider) {
            const day   = new Date(lastSeenBatch.created_at).toLocaleDateString("en-GB", { weekday: "long" });
            const label = `${day}, ${lastSeenBatch.label}`;
            const leftText = newRows.length === 0
                ? `Nothing new since ${esc(label)}`
                : `↓ Last loaded ${esc(label)}`;
            dividerHtml = `
            <tr class="divider-banner">
                <td colspan="12"><div class="divider-inner"><span>${leftText}</span></div></td>
            </tr>`;
        }

        document.getElementById("table-container").innerHTML = `
        <table>
            <thead><tr>
                <th></th><th>Title</th><th>Buyer</th><th>Value</th>
                <th>Stage</th><th>FW</th><th>CPVs</th><th>Awarded Supplier</th><th>Description</th><th>Dates</th><th>Term</th><th>Route</th>
            </tr></thead>
            <tbody>
                ${pageNewRows.map(renderRow).join("")}
                ${dividerHtml}
                ${pageOldRows.map(renderRow).join("")}
            </tbody>
        </table>`;

        // Pagination bar
        if (totalPages > 1) {
            pgBar.innerHTML = `
            <button class="pg-btn" onclick="changePage(-1)" ${currentPage <= 1 ? "disabled" : ""}>&#8249;</button>
            <span class="pg-info">Page ${currentPage} of ${totalPages} &nbsp;&middot;&nbsp; ${start + 1}–${end} of ${data.length}</span>
            <button class="pg-btn" onclick="changePage(1)" ${currentPage >= totalPages ? "disabled" : ""}>&#8250;</button>`;
        } else {
            pgBar.innerHTML = "";
        }


        initResizableColumns();
    }

    function changePage(delta) {
        currentPage += delta;
        renderPage();
        document.getElementById("table-container").scrollIntoView({ behavior: "smooth", block: "start" });
    }

    // =====================
    // DESCRIPTION POPUP
    // =====================
    function showDescPopup(el) {
        const body = document.getElementById('desc-popup-body');
        // data-html flag means pre-encoded HTML entities (ai text) — use innerHTML
        if (el.dataset.html) {
            body.innerHTML = el.dataset.desc || '';
        } else {
            // Plain text from DB — use textContent to avoid XSS
            body.textContent = el.dataset.desc || '';
        }
        document.getElementById('desc-popup-overlay').classList.remove('hidden');
    }
    function closeDescPopup() {
        document.getElementById('desc-popup-overlay').classList.add('hidden');
    }
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDescPopup(); });

    // =====================
    // TOGGLE OLD ROWS
    // =====================
    function toggleOldRows(btn, count) {
        const table = document.querySelector("#table-container table");
        if (!table) return;
        const showing = table.classList.toggle("show-old");
        btn.textContent = showing
            ? "Hide previous results ↑"
            : `Show ${count} previous result${count !== 1 ? "s" : ""} ↓`;
    }

    // =====================
    // FULLSCREEN VIEW
    // =====================
    function openFullscreen(sessionId, startIndex) {
        const session = triageSessions.find(s => s.session_id === sessionId);
        if (!session || !session.opportunities.length) return;
        fsMode    = "triage";
        fsSession = session;
        fsOpps    = session.opportunities;
        fsIndex   = startIndex || 0;
        fsNotes   = {};
        fsOpps.forEach(o => { fsNotes[String(o.id)] = o.notes || ""; });
        document.getElementById("fullscreen-overlay").classList.remove("hidden");
        document.addEventListener("keydown", fsKeyHandler);
        renderFsCard();
    }

    function openReviewFullscreen(startId) {
        const opps = [...selected.values()];
        if (!opps.length) return;
        fsMode    = "review";
        fsSession = null;
        fsOpps    = opps;
        const idx = opps.findIndex(o => String(o.id) === String(startId));
        fsIndex   = idx >= 0 ? idx : 0;
        fsNotes   = {};
        opps.forEach(o => {
            const meta = reviewMeta.get(String(o.id)) || { notes: "" };
            fsNotes[String(o.id)] = meta.notes || "";
        });
        document.getElementById("fullscreen-overlay").classList.remove("hidden");
        document.addEventListener("keydown", fsKeyHandler);
        renderFsCard();
    }

    function openDashFullscreen(profileId, startIndex) {
        const opps = dashProfileOpps[profileId] || [];
        if (!opps.length) return;
        fsMode    = "dashboard";
        fsSession = null;
        fsOpps    = opps;
        fsIndex   = startIndex || 0;
        fsNotes   = {};
        document.getElementById("fullscreen-overlay").classList.remove("hidden");
        document.addEventListener("keydown", fsKeyHandler);
        renderFsCard();
    }

    function closeFullscreen() {
        fsSaveCurrentNotes();
        if (fsMode === "triage" && fsSession) {
            fsOpps.forEach(o => {
                const key = String(o.id);
                if (key in fsNotes) o.notes = fsNotes[key];
            });
            fsPatchServer();
        } else if (fsMode === "review") {
            fsOpps.forEach(o => {
                const key = String(o.id);
                if (key in fsNotes) {
                    const meta = reviewMeta.get(key) || { score: 0, notes: "" };
                    reviewMeta.set(key, { ...meta, notes: fsNotes[key] });
                    const cardEl = document.getElementById("card-" + key);
                    if (cardEl) {
                        const ta = cardEl.querySelector(".notes-field");
                        if (ta) ta.value = fsNotes[key];
                    }
                }
            });
        }
        document.getElementById("fullscreen-overlay").classList.add("hidden");
        document.removeEventListener("keydown", fsKeyHandler);
        fsSession = null;
        fsOpps    = [];
        if (fsMode === "triage") renderTriage();
    }

    function fsSaveCurrentNotes() {
        const ta = document.getElementById("fs-notes");
        if (ta && fsOpps[fsIndex]) {
            fsNotes[String(fsOpps[fsIndex].id)] = ta.value;
        }
    }

    async function fsPatchServer() {
        if (!fsSession) return;
        const opps = fsOpps.map(o => ({
            id:             String(o.id),
            title:          o.title          || "",
            buyer:          o.buyer          || "",
            value:          parseFloat(o.value) || null,
            cpvs:           o.cpvs           || "",
            stage:          o.stage          || "",
            published_date: (o.published_date || "").substring(0, 10),
            description:    o.description    || "",
            source_url:     o.source_url     || null,
            score:          o.score          || 0,
            notes:          fsNotes[String(o.id)] ?? o.notes ?? "",
            contract_start: o.contract_start || "",
            contract_end:   o.contract_end   || "",
        }));
        try {
            await fetch(`/triage/${encodeURIComponent(fsSession.session_id)}`, {
                method:  "PATCH",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ opportunities: opps }),
            });
        } catch { /* silent — notes are still in memory */ }
    }

    function fsNavigate(dir) {
        fsSaveCurrentNotes();
        fsIndex = Math.max(0, Math.min(fsOpps.length - 1, fsIndex + dir));
        renderFsCard();
    }

    function fsKeyHandler(e) {
        if (e.key === "ArrowLeft"  && !e.target.matches("textarea")) { e.preventDefault(); fsNavigate(-1); }
        if (e.key === "ArrowRight" && !e.target.matches("textarea")) { e.preventDefault(); fsNavigate(1); }
        if (e.key === "Escape") closeFullscreen();
    }

    function renderFsCard() {
        const o     = fsOpps[fsIndex];
        const total = fsOpps.length;
        const fmt   = v => { const n = parseFloat(v); return isNaN(n) ? "—" : "£" + n.toLocaleString("en-GB"); };
        const id    = String(o.id);
        const notes = fsNotes[id] ?? "";

        const headerLabel = fsMode === "review" ? "Review"
                          : fsMode === "dashboard" ? "Dashboard"
                          : (fsSession ? fsSession.label : "");
        document.getElementById("fs-header-label").textContent = headerLabel;
        document.getElementById("fs-progress").textContent     = `${fsIndex + 1} / ${total}`;
        document.getElementById("fs-prev").disabled = fsIndex === 0;
        document.getElementById("fs-next").disabled = fsIndex === total - 1;

        const stages = (o.stage || "").split(",").filter(Boolean)
            .map(s => `<span>${esc(s.trim())}</span>`).join("");

        document.getElementById("fs-card-inner").innerHTML = `
            <div class="fs-title">
                ${o.source_url
                    ? `<a href="${esc(o.source_url)}" target="_blank" rel="noopener">${esc(o.title || "—")}</a>`
                    : esc(o.title || "—")}
            </div>
            <div class="fs-meta">
                <span><span class="meta-lbl">Supplier</span>${esc(o.buyer || "—")}</span>
                <span><span class="meta-lbl">TCV</span>${fmt(o.value)}</span>
                <span><span class="meta-lbl">Published</span>${fmtDateOnly(o.published_date)}</span>
                ${fmtContract(o.contract_start, o.contract_end)
                    ? `<span><span class="meta-lbl">Contract</span>${fmtContract(o.contract_start, o.contract_end)}</span>`
                    : ""}
                ${o.date_modified && o.date_modified.substring(0,16) !== (o.published_date||"").substring(0,16)
                    ? `<span style="color:#aaa;"><span class="meta-lbl">Modified</span>${fmtDateOnly(o.date_modified)}</span>`
                    : ""}
            </div>
            ${stages ? `<div class="fs-tags">${stages}</div>` : ""}
            ${o.cpvs ? `<div class="fs-cpvs">CPVs: ${esc(o.cpvs)}</div>` : ""}
            <hr class="fs-divider">
            <div class="fs-description">${esc(o.description || "No description provided")}</div>
            <hr class="fs-divider">
            ${fsMode === "dashboard"
                ? `<div style="font-size:0.8rem;color:#bbb;font-style:italic;padding:4px 0;">
                       ⚡ AI recommendation — not yet configured
                   </div>`
                : `<div>
                       <div class="fs-notes-label">Notes</div>
                       <textarea class="fs-notes-textarea" id="fs-notes"
                           placeholder="Add notes for this opportunity…">${esc(notes)}</textarea>
                   </div>`
            }`;

        if (fsMode !== "dashboard") {
            document.getElementById("fs-notes").setSelectionRange(0, 0);
        }
    }

    // =====================
    // DELETE TRIAGE SESSION
    // =====================
    async function deleteTriageSession(sessionId, label) {
        if (!confirm(`Delete triage session "${label}"?\n\nThis cannot be undone.`)) return;
        try {
            const resp = await fetch(`/triage/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
            if (!resp.ok) throw new Error();
            triageSessions = triageSessions.filter(s => s.session_id !== sessionId);
            updateTriageBadge();
            renderTriage();
        } catch {
            alert("Failed to delete session. Please try again.");
        }
    }

    // =====================
    // TOGGLE TRIAGE SESSION
    // =====================
    function toggleSession(sessionId) {
        const sessionEl = document.querySelector(`.triage-session[data-session="${sessionId}"]`);
        if (!sessionEl) return;
        const icon = sessionEl.querySelector(".batch-toggle-icon");
        if (collapsedSessions.has(sessionId)) {
            collapsedSessions.delete(sessionId);
            sessionEl.classList.remove("collapsed");
            if (icon) icon.textContent = "▼";
        } else {
            collapsedSessions.add(sessionId);
            sessionEl.classList.add("collapsed");
            if (icon) icon.textContent = "▶";
        }
    }

    // =====================
    // SELECTION (main table)
    // =====================
    function toggleSelected(checkbox) {
        const id  = checkbox.dataset.id;
        const opp = JSON.parse(decodeURIComponent(escape(atob(checkbox.dataset.opp))));
        const row = document.getElementById("row-" + id);
        if (checkbox.checked) {
            selected.set(id, opp);
            if (!reviewMeta.has(id)) reviewMeta.set(id, { score: 0, notes: "" });
            if (row) row.classList.add("selected-row");
        } else {
            selected.delete(id);
            if (row) row.classList.remove("selected-row");
        }
        updateSelectionBar();
    }

    function updateSelectionBar() {
        const count = selected.size;
        const bar   = document.getElementById("selection-bar");
        const badge      = document.getElementById("badge-review");
        const badgeInner = document.getElementById("badge-review-inner");
        document.getElementById("selection-label").textContent =
            `${count} opportunit${count === 1 ? "y" : "ies"} selected`;
        if (count > 0) {
            bar.classList.remove("hidden");
            [badge, badgeInner].forEach(b => { if (b) { b.textContent = count; b.classList.remove("hidden"); } });
        } else {
            bar.classList.add("hidden");
            [badge, badgeInner].forEach(b => { if (b) b.classList.add("hidden"); });
        }
    }

    // =====================
    // REVIEW TAB
    // =====================
    function renderReview() {
        // Clear triage selections whenever review re-renders
        triageSelected.clear();
        updateTriageBar();

        const container = document.getElementById("review-container");
        const countEl   = document.getElementById("review-count");

        const clearBtn = document.getElementById("clear-review-btn");
        if (selected.size === 0) {
            container.innerHTML = `<div class="review-empty">No opportunities selected yet.<br>
                Go to the <strong>Opportunities</strong> tab and tick some checkboxes.</div>`;
            countEl.textContent = "";
            if (clearBtn) clearBtn.classList.add("hidden");
            return;
        }

        if (clearBtn) clearBtn.classList.remove("hidden");
        countEl.textContent = `${selected.size} selected`;
        const fmt = v => { const n = parseFloat(v); return isNaN(n) ? "—" : "£" + n.toLocaleString("en-GB"); };

        const cards = [...selected.values()].map(o => {
            const id     = String(o.id);
            const meta   = reviewMeta.get(id) || { score: 0, notes: "" };
            const stages = (o.stage || "").split(",").filter(Boolean)
                .map(s => `<span>${esc(s.trim())}</span>`).join("");
            return `
            <div class="review-card" id="card-${id}">
                <div class="card-select">
                    <input type="checkbox" id="triage-cb-${id}"
                        onchange="toggleTriageSelect('${id}', this.checked)">
                </div>
                <div class="card-main">
                    <div class="card-title">
                        ${o.source_url
                            ? `<a href="${esc(o.source_url)}" target="_blank" rel="noopener">${esc(o.title || "—")}</a>`
                            : esc(o.title || "—")}
                    </div>
                    <div class="card-meta">
                        <span><span class="meta-lbl">Supplier</span>${esc(o.buyer || "—")}</span>
                        <span><span class="meta-lbl">TCV</span>${fmt(o.value)}</span>
                        <span><span class="meta-lbl">Published</span>${fmtDate(o.published_date)}</span>
                        ${o.date_modified && o.date_modified.substring(0,16) !== (o.published_date||"").substring(0,16)
                            ? `<span style="color:#888;"><span class="meta-lbl">Modified</span>${fmtDate(o.date_modified)}</span>`
                            : ""}
                        ${fmtContract(o.contract_start, o.contract_end)
                            ? `<span><span class="meta-lbl">Contract</span>${fmtContract(o.contract_start, o.contract_end)}</span>`
                            : ""}
                    </div>
                    ${stages ? `<div class="card-tags">${stages}</div>` : ""}
                    <div class="card-desc">${esc(o.description || "No description provided")}</div>
                    ${o.cpvs ? `<div style="font-size:0.73rem;color:#999;margin-top:4px;">CPVs: ${esc(o.cpvs)}</div>` : ""}
                </div>
                <div class="card-actions">
                    <div>
                        <div style="font-size:0.75rem;font-weight:600;color:#555;margin-bottom:4px;">Notes</div>
                        <textarea class="notes-field" placeholder="Add notes…"
                            oninput="setNotes('${id}', this.value)">${esc(meta.notes)}</textarea>
                    </div>
                    <button class="card-view-btn" onclick="openReviewFullscreen('${id}')">Full View</button>
                    <button class="remove-btn" onclick="removeFromReview('${id}')">✕ Remove</button>
                </div>
            </div>`;
        }).join("");

        container.innerHTML = cards;
    }

    function setNotes(id, notes) {
        const meta = reviewMeta.get(id) || { score: 0, notes: "" };
        reviewMeta.set(id, { ...meta, notes });
    }

    function clearReview() {
        if (!confirm(`Remove all ${selected.size} opportunit${selected.size === 1 ? "y" : "ies"} from review?`)) return;
        selected.forEach((opp, id) => {
            const cb = document.querySelector(`input[data-id="${id}"]`);
            if (cb) cb.checked = false;
            const row = document.getElementById("row-" + id);
            if (row) row.classList.remove("selected-row");
        });
        selected.clear();
        reviewMeta.clear();
        triageSelected.clear();
        updateSelectionBar();
        updateTriageBar();
        renderReview();
    }

    function removeFromReview(id) {
        selected.delete(id);
        reviewMeta.delete(id);
        triageSelected.delete(id);
        const cb = document.querySelector(`input[data-id="${id}"]`);
        if (cb) cb.checked = false;
        const row = document.getElementById("row-" + id);
        if (row) row.classList.remove("selected-row");
        updateSelectionBar();
        updateTriageBar();
        renderReview();
    }

    // =====================
    // TRIAGE SELECTION (review tab)
    // =====================
    function toggleTriageSelect(id, checked) {
        if (checked) triageSelected.add(id);
        else triageSelected.delete(id);
        updateTriageBar();
    }

    function updateTriageBar() {
        const bar   = document.getElementById("triage-bar");
        const label = document.getElementById("triage-bar-label");
        const count = triageSelected.size;
        label.textContent = `${count} selected for triage`;
        if (count > 0) bar.classList.remove("hidden");
        else bar.classList.add("hidden");
    }

    async function submitTriage() {
        if (triageSelected.size === 0) return;
        const btn = document.getElementById("triage-submit-btn");
        btn.disabled = true;
        btn.textContent = "Saving…";

        const opportunities = [...triageSelected].map(id => {
            const opp  = selected.get(id);
            const meta = reviewMeta.get(id) || { score: 0, notes: "" };
            return {
                id:             String(opp.id),
                title:          opp.title          || "",
                buyer:          opp.buyer          || "",
                value:          parseFloat(opp.value) || null,
                cpvs:           opp.cpvs           || "",
                stage:          opp.stage          || "",
                published_date: (opp.published_date || "").substring(0, 10),
                description:    opp.description    || "",
                source_url:     opp.source_url     || null,
                score:          meta.score,
                notes:          meta.notes,
                contract_start: opp.contract_start || "",
                contract_end:   opp.contract_end   || "",
            };
        });

        try {
            const resp = await fetch("/triage", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ opportunities }),
            });
            if (!resp.ok) throw new Error();
            const session = await resp.json();
            triageSessions.unshift(session);
            updateTriageBadge();
            triageSelected.clear();
            updateTriageBar();
            switchTab("triage");
        } catch {
            alert("Failed to save triage session. Please try again.");
        } finally {
            btn.disabled = false;
            btn.textContent = "Add to Morning Triage →";
        }
    }

    // =====================
    // TRIAGE TAB
    // =====================
    async function loadTriageSessions() {
        try {
            const resp = await fetch("/triage");
            const data = await resp.json();
            triageSessions = data.sessions || [];
            updateTriageBadge();
        } catch {
            triageSessions = [];
        }
    }

    function updateTriageBadge() {
        const badge = document.getElementById("badge-triage");
        if (triageSessions.length > 0) {
            badge.textContent = triageSessions.length;
            badge.classList.remove("hidden");
        } else {
            badge.classList.add("hidden");
        }
    }

    function renderTriage() {
        const container = document.getElementById("triage-container");
        const countEl   = document.getElementById("triage-count");

        if (!triageSessions.length) {
            container.innerHTML = `<div class="review-empty">No triage sessions yet.<br>
                Select cards in the <strong>Review</strong> tab, then click
                <em>Add to Morning Triage</em>.</div>`;
            countEl.textContent = "";
            return;
        }

        countEl.textContent = `${triageSessions.length} session${triageSessions.length !== 1 ? "s" : ""}`;
        const fmt = v => { const n = parseFloat(v); return isNaN(n) ? "—" : "£" + n.toLocaleString("en-GB"); };

        const html = triageSessions.map((session, idx) => {
            const sid = session.session_id;
            const isCollapsed = collapsedSessions.has(sid);
            const toggleIcon  = isCollapsed ? "▶" : "▼";
            const count = session.opportunities.length;
            const dayOfWeek = session.created_at
                ? new Date(session.created_at).toLocaleDateString("en-GB", { weekday: "long" })
                : "";
            const displayLabel = dayOfWeek ? `${dayOfWeek}, ${session.label}` : session.label;

            const cards = session.opportunities.map((o, idx) => `
                <div class="triage-card">
                    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
                        <div class="card-title">
                            ${o.source_url
                                ? `<a href="${esc(o.source_url)}" target="_blank" rel="noopener">${esc(o.title || "—")}</a>`
                                : esc(o.title || "—")}
                        </div>
                        <button class="card-view-btn" style="flex-shrink:0;"
                            onclick="openFullscreen('${esc(sid)}', ${idx})">View</button>
                    </div>
                    <div class="card-meta">
                        <span><span class="meta-lbl">Supplier</span>${esc(o.buyer || "—")}</span>
                        <span><span class="meta-lbl">TCV</span>${fmt(o.value)}</span>
                        <span><span class="meta-lbl">Published</span>${fmtDateOnly(o.published_date)}</span>
                        ${fmtContract(o.contract_start, o.contract_end)
                            ? `<span><span class="meta-lbl">Contract</span>${fmtContract(o.contract_start, o.contract_end)}</span>`
                            : ""}
                    </div>
                    ${o.stage ? `<div class="card-tags">${
                        o.stage.split(",").filter(Boolean)
                            .map(s => `<span>${esc(s.trim())}</span>`).join("")
                    }</div>` : ""}
                    <div class="card-desc">${esc(o.description || "")}</div>
                    ${o.notes ? `<div class="triage-card-notes">${esc(o.notes)}</div>` : ""}
                </div>`).join("");

            return `
            <div class="triage-session${isCollapsed ? " collapsed" : ""}" data-session="${esc(sid)}">
                <div class="triage-session-header" onclick="toggleSession('${esc(sid)}')">
                    <span class="batch-toggle-icon">${toggleIcon}</span>
                    ${idx === 0 ? `<span class="triage-badge">Latest</span>` : ""}
                    <span class="triage-session-label">${esc(displayLabel)}</span>
                    <span class="triage-session-count">${count} opportunit${count !== 1 ? "ies" : "y"}</span>
                    <button class="view-session-btn"
                        onclick="event.stopPropagation(); openFullscreen('${esc(sid)}', 0)">
                        Full Screen
                    </button>
                    <button class="delete-session-btn"
                        onclick="event.stopPropagation(); deleteTriageSession('${esc(sid)}', '${esc(displayLabel)}')">
                        Delete
                    </button>
                </div>
                <div class="triage-session-body">
                    ${cards}
                </div>
            </div>`;
        }).join("");

        container.innerHTML = html;
    }

    // =====================
    // STAGES / FILTERS
    // =====================
    function populateStages(data) {
        if (stagesPopulated) return;
        const seen = new Set(KNOWN_STAGES);
        data.forEach(o => (o.stage || "").split(",").forEach(s => { if (s.trim()) seen.add(s.trim()); }));
        document.getElementById("stage-checkboxes").innerHTML =
            [...seen].sort().map(s =>
                `<label><input type="checkbox" value="${s}" onchange="debouncedFetch()"> ${s}</label>`
            ).join("");
        stagesPopulated = true;
        // Apply any stages that were requested before checkboxes existed
        if (_pendingFatStages) { _applyFatStages(_pendingFatStages); _pendingFatStages = null; }
    }

    function clearFilters() {
        ["f-keyword","f-cpv","f-min","f-max","f-buyer","f-date-from","f-date-to"]
            .forEach(id => document.getElementById(id).value = "");
        document.querySelectorAll("#stage-checkboxes input").forEach(cb => cb.checked = false);
        const fwCb = document.getElementById("f-framework-only");
        if (fwCb) fwCb.checked = false;
        // Reset offering pills
        document.querySelectorAll('.off-pill').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.off-pill[data-view="all"]').forEach(p => p.classList.add('active'));
        // Reset route filter
        _routeFilter = new Set();
        document.querySelectorAll('#route-checkboxes input').forEach(cb => cb.checked = false);
        fetchAndRender();
    }

    const _OFFERING_PRESETS = {
        all:       { keyword: '',          cpv: '' },
        security:  { keyword: 'security',  cpv: '72' },
        cloud:     { keyword: 'cloud',     cpv: '72' },
        workplace: { keyword: 'workplace', cpv: '72,48,30' },
        network:   { keyword: 'network',   cpv: '32,72' }
    };

    function toggleSidebar() {
        const sb  = document.getElementById('opp-sidebar');
        const btn = document.getElementById('sidebar-toggle-btn');
        const collapsed = sb.classList.toggle('collapsed');
        btn.innerHTML   = collapsed ? '&#8250;' : '&#8249;';
        btn.title       = collapsed ? 'Show filters' : 'Hide filters';
        localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
    }

    // Restore sidebar state on load
    (function() {
        if (localStorage.getItem('sidebarCollapsed') === '1') {
            const sb  = document.getElementById('opp-sidebar');
            const btn = document.getElementById('sidebar-toggle-btn');
            if (sb)  sb.classList.add('collapsed');
            if (btn) { btn.innerHTML = '&#8250;'; btn.title = 'Show filters'; }
        }
    })();

    function filterByOffering(viewId, src) {
        // Update active pill state for this source's pill group
        const container = document.getElementById('off-pills-' + src);
        if (container) {
            container.querySelectorAll('.off-pill').forEach(p => p.classList.remove('active'));
            const active = container.querySelector(`.off-pill[data-view="${viewId}"]`);
            if (active) active.classList.add('active');
        }
        const preset = _OFFERING_PRESETS[viewId] || { keyword: '', cpv: '' };
        // Set keyword and CPV fields for the relevant source
        const kwId  = src === 'fat' ? 'f-keyword' : src + '-keyword';
        const cpvId = src === 'fat' ? 'f-cpv'     : src + '-cpv';
        const kwEl  = document.getElementById(kwId);
        const cpvEl = document.getElementById(cpvId);
        if (kwEl)  kwEl.value  = preset.keyword;
        if (cpvEl) cpvEl.value = preset.cpv;
        debouncedFetch();
    }

    function debouncedFetch() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(fetchAndRender, 350);
    }

    function esc(str) {
        return String(str)
            .replace(/&/g,"&amp;").replace(/</g,"&lt;")
            .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    }

    function fmtDate(iso) {
        if (!iso) return "—";
        const d = new Date(iso);
        if (isNaN(d.getTime())) return (iso || "").substring(0, 10) || "—";
        const day  = d.getDate();
        const mon  = d.toLocaleString("en-GB", { month: "short" });
        const yr   = d.getFullYear();
        const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
        return `${day} ${mon} ${yr}, ${time}`;
    }

    function fmtDateOnly(iso) {
        if (!iso) return "";
        const d = new Date(iso);
        if (isNaN(d.getTime())) return (iso || "").substring(0, 10) || "";
        return `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })} ${d.getFullYear()}`;
    }

    function fmtContract(start, end) {
        if (!start && !end) return "";
        const s = fmtDateOnly(start);
        const e = fmtDateOnly(end);
        if (s && e) return `${s} – ${e}`;
        if (s)      return `From ${s}`;
        return `To ${e}`;
    }

    function contractMonths(months, start, end) {
        const m = parseInt(months);
        if (!isNaN(m) && m > 0) return m + " mo";
        if (!start || !end) return "—";
        const s = new Date(start), e = new Date(end);
        if (isNaN(s) || isNaN(e)) return "—";
        const calc = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
        return calc > 0 ? calc + " mo" : "—";
    }

    function buildCpvCell(cpvsStr) {
        const cpvs = (cpvsStr || "").split(",").map(c => c.trim()).filter(Boolean);
        if (!cpvs.length) return "—";
        const items = cpvs.map(c => esc(c)).join("<br>");
        if (cpvs.length <= 3) return items;
        return `<div class="cpv-scroll">${items}</div>`;
    }

    function buildFwCell(fw) {
        const parts = (fw || "").split(",").map(s => s.trim()).filter(Boolean);
        if (!parts.length) return "";
        return parts.map(p => {
            const cls = p === "FA" ? "fw-badge--fa" : "fw-badge--dps";
            return `<span class="fw-badge ${cls}">${esc(p)}</span>`;
        }).join("<br>");
    }

    // =====================
    // RESIZABLE COLUMNS
    // =====================
    const colWidths = {};

    function initResizableColumns() {
        const table = document.querySelector("#table-container table");
        if (!table) return;
        const ths = [...table.querySelectorAll("thead th")];

        // Re-apply stored widths and fix layout so they hold
        if (Object.keys(colWidths).length) {
            ths.forEach((th, i) => { if (colWidths[i] !== undefined) th.style.width = colWidths[i] + "px"; });
            table.style.tableLayout = "fixed";
        }

        ths.forEach((th, i) => {
            if (i === 0) return; // skip checkbox
            if (th.querySelector(".col-resize-handle")) return;
            const handle = document.createElement("div");
            handle.className = "col-resize-handle";
            th.appendChild(handle);

            handle.addEventListener("mousedown", e => {
                e.preventDefault();
                // Snapshot all widths the first time a column is dragged
                if (table.style.tableLayout !== "fixed") {
                    ths.forEach((t, idx) => { const w = t.offsetWidth; t.style.width = w + "px"; colWidths[idx] = w; });
                    table.style.tableLayout = "fixed";
                }
                const startX  = e.pageX;
                const startW  = th.offsetWidth;
                document.body.style.cursor     = "col-resize";
                document.body.style.userSelect = "none";

                const onMove = e => {
                    const w = Math.max(50, startW + e.pageX - startX);
                    th.style.width = w + "px";
                    colWidths[i]   = w;
                    document.getElementById("reset-cols-btn").classList.remove("hidden");
                };
                const onUp = () => {
                    document.removeEventListener("mousemove", onMove);
                    document.removeEventListener("mouseup",   onUp);
                    document.body.style.cursor     = "";
                    document.body.style.userSelect = "";
                };
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup",   onUp);
            });
        });
    }

    function resetColWidths() {
        Object.keys(colWidths).forEach(k => delete colWidths[k]);
        const table = document.querySelector("#table-container table");
        if (table) {
            table.style.tableLayout = "";
            [...table.querySelectorAll("thead th")].forEach(th => th.style.width = "");
        }
        document.getElementById("reset-cols-btn").classList.add("hidden");
    }

    // =====================
    // SAVED SEARCHES
    // =====================
    const SS_KEY = "tenderSavedSearches";
    let _pendingFatStages = null;

    function _ssLoad() {
        try { return JSON.parse(localStorage.getItem(SS_KEY) || "{}"); } catch { return {}; }
    }
    function _ssSave(all) { localStorage.setItem(SS_KEY, JSON.stringify(all)); }
    function ssGet(src)   { return (_ssLoad()[src] || []); }

    function toggleSavedSearches(src) {
        const body  = document.getElementById("ss-body-" + src);
        const caret = document.getElementById("ss-caret-" + src);
        const open  = body.style.display !== "block";
        body.style.display = open ? "block" : "none";
        caret.textContent  = open ? "▾" : "▸";
    }

    function captureParams(src) {
        if (src === "fat") {
            const stages = [...document.querySelectorAll("#stage-checkboxes input:checked")].map(c => c.value);
            return {
                keyword: document.getElementById("f-keyword").value,
                cpv:     document.getElementById("f-cpv").value,
                min:     document.getElementById("f-min").value,
                max:     document.getElementById("f-max").value,
                stages,
                buyer:    document.getElementById("f-buyer").value,
                dateFrom: document.getElementById("f-date-from").value,
                dateTo:   document.getElementById("f-date-to").value,
                frameworkOnly: document.getElementById("f-framework-only")?.checked || false,
            };
        }
        if (src === "cf") {
            const stages = ["planning","tender","award","contract"]
                .filter(s => document.getElementById("cf-stage-" + s)?.checked);
            return {
                keyword: document.getElementById("cf-keyword").value,
                cpv:     document.getElementById("cf-cpv").value,
                min:     document.getElementById("cf-min").value,
                max:     document.getElementById("cf-max").value,
                stages,
                buyer:    document.getElementById("cf-buyer").value,
                dateFrom: document.getElementById("cf-date-from").value,
                dateTo:   document.getElementById("cf-date-to").value,
                daysBack: document.getElementById("cf-days-back").value,
            };
        }
        if (src === "pcs") {
            const stages = [1,4,5]
                .filter(t => document.getElementById("pcs-type-" + t)?.checked)
                .map(String);
            return {
                keyword: document.getElementById("pcs-keyword").value,
                cpv:     document.getElementById("pcs-cpv").value,
                min:     document.getElementById("pcs-min").value,
                max:     document.getElementById("pcs-max").value,
                stages,
                buyer:    document.getElementById("pcs-buyer").value,
                dateFrom: document.getElementById("pcs-date-from").value,
                dateTo:   document.getElementById("pcs-date-to").value,
                monthsBack: document.getElementById("pcs-months-back").value,
            };
        }
        return {};
    }

    function _applyFatStages(stages) {
        document.querySelectorAll("#stage-checkboxes input").forEach(cb => {
            cb.checked = stages.includes(cb.value);
        });
    }

    function applyParams(src, params) {
        if (src === "fat") {
            document.getElementById("f-keyword").value   = params.keyword  || "";
            document.getElementById("f-cpv").value       = params.cpv      || "";
            document.getElementById("f-min").value       = params.min      || "";
            document.getElementById("f-max").value       = params.max      || "";
            document.getElementById("f-buyer").value     = params.buyer    || "";
            document.getElementById("f-date-from").value = params.dateFrom || "";
            document.getElementById("f-date-to").value   = params.dateTo   || "";
            const fwCb = document.getElementById("f-framework-only");
            if (fwCb) fwCb.checked = !!params.frameworkOnly;
            _pendingFatStages = params.stages || [];
            _applyFatStages(_pendingFatStages);
        }
        if (src === "cf") {
            document.getElementById("cf-keyword").value   = params.keyword  || "";
            document.getElementById("cf-cpv").value       = params.cpv      || "";
            document.getElementById("cf-min").value       = params.min      || "";
            document.getElementById("cf-max").value       = params.max      || "";
            document.getElementById("cf-buyer").value     = params.buyer    || "";
            document.getElementById("cf-date-from").value = params.dateFrom || "";
            document.getElementById("cf-date-to").value   = params.dateTo   || "";
            if (params.daysBack) document.getElementById("cf-days-back").value = params.daysBack;
            ["planning","tender","award","contract"].forEach(s => {
                const el = document.getElementById("cf-stage-" + s);
                if (el) el.checked = (params.stages || []).includes(s);
            });
        }
        if (src === "pcs") {
            document.getElementById("pcs-keyword").value   = params.keyword   || "";
            document.getElementById("pcs-cpv").value       = params.cpv       || "";
            document.getElementById("pcs-min").value       = params.min       || "";
            document.getElementById("pcs-max").value       = params.max       || "";
            document.getElementById("pcs-buyer").value     = params.buyer     || "";
            document.getElementById("pcs-date-from").value = params.dateFrom  || "";
            document.getElementById("pcs-date-to").value   = params.dateTo    || "";
            if (params.monthsBack) document.getElementById("pcs-months-back").value = params.monthsBack;
            [1,4,5].forEach(t => {
                const el = document.getElementById("pcs-type-" + t);
                if (el) el.checked = (params.stages || []).includes(String(t));
            });
        }
    }

    function saveCurrentSearch(src) {
        const input = document.getElementById("ss-name-" + src);
        const name  = (input.value || "").trim();
        if (!name) { input.focus(); return; }
        const all = _ssLoad();
        if (!all[src]) all[src] = [];
        all[src].push({ id: String(Date.now()), name, params: captureParams(src) });
        _ssSave(all);
        input.value = "";
        renderSavedSearches(src);
        // Auto-open the panel so the user sees the new entry
        const body = document.getElementById("ss-body-" + src);
        if (body && body.style.display !== "block") toggleSavedSearches(src);
    }

    function applySavedSearch(src, id) {
        const search = ssGet(src).find(s => s.id === id);
        if (!search) return;
        if (activeSource !== src) switchSource(src);
        applyParams(src, search.params);
        fetchAndRender();
    }

    function deleteSavedSearch(src, id) {
        const all = _ssLoad();
        if (all[src]) all[src] = all[src].filter(s => s.id !== id);
        _ssSave(all);
        renderSavedSearches(src);
    }

    function renderSavedSearches(src) {
        const list    = document.getElementById("ss-list-" + src);
        const countEl = document.getElementById("ss-count-" + src);
        if (!list) return;
        const searches = ssGet(src);

        countEl.textContent  = searches.length || "";
        countEl.style.display = searches.length ? "" : "none";

        if (!searches.length) {
            list.innerHTML = `<div class="ss-empty">No saved searches yet.</div>`;
            return;
        }
        list.innerHTML = searches.map(s => `
            <div class="ss-item">
                <span class="ss-name" title="${esc(s.name)}">${esc(s.name)}</span>
                <button class="ss-apply-btn" onclick="applySavedSearch('${src}','${s.id}')">Apply</button>
                <button class="ss-del-btn"   onclick="deleteSavedSearch('${src}','${s.id}')" title="Delete">×</button>
            </div>`).join("");
    }

    // =====================================================================
    // DASHBOARD
    // =====================================================================
    const DASH_KEY = "dashboardProfiles";
    const DASH_SWATCHES = ["#4a90d9","#f07232","#27a050","#8b5cf6","#e11d48","#0891b2"];
    const DASH_SRC_LABELS = { fat: "Find a Tender", cf: "Contracts Finder", pcs: "Public Contracts Scotland" };
    const DASH_SRC_MAP = {
        "Find a Tender": "fat",
        "Contracts Finder": "cf",
        "Public Contracts Scotland": "pcs"
    };

    let dashAllOpps    = [];
    let dashDays       = [];   // sorted unique YYYYMMDD published_date keys, descending
    let dashDayIndex   = 0;
    let dashCollapsed  = new Set();
    let dashProfileOpps = {};  // profileId -> matched opps for current day (for fullscreen nav)

    function _loadDashProfiles() {
        try { return JSON.parse(localStorage.getItem(DASH_KEY)) || []; }
        catch { return []; }
    }
    function _saveDashProfiles(arr) { localStorage.setItem(DASH_KEY, JSON.stringify(arr)); }

    function batchDayKey(o) {
        return (o.published_date || "").substring(0, 10).replace(/-/g, "") || "unknown";
    }

    function dashJumpToDate(dateStr) {
        const key = dateStr.replace(/-/g, "");
        const idx = dashDays.indexOf(key);
        if (idx >= 0) { dashDayIndex = idx; renderDashDay(); }
    }

    function formatDayLabel(key) {
        if (!key || key === "unknown") return "Unknown date";
        const y = key.substring(0,4), m = key.substring(4,6), d = key.substring(6,8);
        return new Date(`${y}-${m}-${d}T12:00:00`).toLocaleDateString("en-GB",
            { weekday:"long", day:"numeric", month:"long", year:"numeric" });
    }

    async function fetchAndRenderDashboard() {
        document.getElementById("dash-day-label").textContent = "Loading…";
        document.getElementById("dash-accounts-container").innerHTML =
            "<div class='empty-state'>Fetching all sources…</div>";
        try {
            const [fat, cf, pcs] = await Promise.all([
                fetch("/opportunities").then(r => r.json()),
                fetch("/live/contracts-finder").then(r => r.json()),
                fetch("/live/pcs").then(r => r.json()),
            ]);
            dashAllOpps = [
                ...fat.map(o => ({...o, _src: DASH_SRC_MAP[o.source] || "fat"})),
                ...cf.map(o  => ({...o, _src: DASH_SRC_MAP[o.source] || "cf"})),
                ...pcs.map(o => ({...o, _src: DASH_SRC_MAP[o.source] || "pcs"})),
            ];
            const daySet = new Set(dashAllOpps.map(batchDayKey));
            dashDays = [...daySet].filter(k => k !== "unknown").sort().reverse();
            if (!dashDays.length && daySet.has("unknown")) dashDays = ["unknown"];
            dashDayIndex = 0;

            // Show staleness warning
            const lastLoaded = document.getElementById("dash-last-loaded");
            if (lastLoaded && dashDays.length) {
                const newest = dashDays[0];
                const newestDate = new Date(`${newest.substring(0,4)}-${newest.substring(4,6)}-${newest.substring(6,8)}T12:00:00`);
                const daysSince = Math.round((Date.now() - newestDate.getTime()) / 86400000);
                if (daysSince > 1) {
                    lastLoaded.textContent = `⚠ Last data: ${daysSince} day${daysSince===1?"":"s"} ago — use ↻ Catch up to load missed days`;
                    lastLoaded.style.color = "#e07b30";
                } else {
                    lastLoaded.textContent = `Data up to date (loaded today)`;
                    lastLoaded.style.color = "#27a050";
                }
            }

            renderDashDay();
        } catch(e) {
            document.getElementById("dash-day-label").textContent = "Error loading data";
            document.getElementById("dash-accounts-container").innerHTML =
                `<div class='empty-state'>${e.message}</div>`;
        }
    }

    function dashNavDay(delta) {
        dashDayIndex = Math.max(0, Math.min(dashDays.length - 1, dashDayIndex + delta));
        renderDashDay();
    }

    function renderDashDay() {
        const dayKey = dashDays[dashDayIndex] || null;
        document.getElementById("dash-day-label").textContent =
            dayKey ? formatDayLabel(dayKey) : "No data loaded";
        document.getElementById("dash-prev").disabled = dashDayIndex >= dashDays.length - 1;
        document.getElementById("dash-next").disabled = dashDayIndex <= 0;

        // Sync calendar picker
        if (dayKey && dayKey !== "unknown") {
            const iso = `${dayKey.substring(0,4)}-${dayKey.substring(4,6)}-${dayKey.substring(6,8)}`;
            document.getElementById("dash-date-picker").value = iso;
        }

        const dayOpps = dayKey
            ? dashAllOpps.filter(o => batchDayKey(o) === dayKey)
            : dashAllOpps;
        document.getElementById("dash-day-sub").textContent =
            dayKey ? `${dayOpps.length} published · ${dashDayIndex+1} of ${dashDays.length} days` : "";

        const profiles = _loadDashProfiles();
        const container = document.getElementById("dash-accounts-container");
        if (!profiles.length) {
            container.innerHTML = `<div class='empty-state'>No account profiles configured yet.
                Click <strong>Manage Accounts</strong> to add one.</div>`;
            return;
        }
        // Store matched opps per profile so fullscreen nav can reference them
        dashProfileOpps = {};
        container.innerHTML = profiles.map(p => {
            const matched = filterForAccount(dayOpps, p);
            dashProfileOpps[p.id] = matched;
            const isCollapsed = dashCollapsed.has(p.id);
            return `
            <div class="dash-account-section${isCollapsed?" collapsed":""}"
                 style="border-left-color:${p.color||"#4a90d9"}">
                <div class="dash-account-header" onclick="toggleDashSection('${p.id}')">
                    <span class="dash-account-name">${esc(p.name)}</span>
                    <span class="dash-account-count">${matched.length} match${matched.length===1?"":"es"}</span>
                    <button class="dash-collapse-btn">${isCollapsed?"▶":"▼"}</button>
                </div>
                <div class="dash-account-body">
                    ${matched.length
                        ? matched.map((o, i) => buildDashCard(o, p.id, i)).join("")
                        : "<div class='dash-empty'>No matching opportunities published on this day.</div>"
                    }
                </div>
            </div>`;
        }).join("");
    }

    function toggleDashSection(profileId) {
        if (dashCollapsed.has(profileId)) dashCollapsed.delete(profileId);
        else dashCollapsed.add(profileId);
        renderDashDay();
    }

    function filterForAccount(opps, profile) {
        const cpvPrefixes   = (profile.cpvPrefixes   || []).map(s => s.trim()).filter(Boolean);
        const keywords      = (profile.keywords      || []).map(s => s.trim().toLowerCase()).filter(Boolean);
        const stages        = (profile.stages        || []).map(s => s.trim().toLowerCase()).filter(Boolean);
        const buyerKeywords = (profile.buyerKeywords || []).map(s => s.trim().toLowerCase()).filter(Boolean);
        const sources       = profile.sources || ["fat","cf","pcs"];

        return opps.filter(o => {
            if (sources.length && !sources.includes(o._src)) return false;
            const val = parseFloat(o.value) || 0;
            if (profile.minValue && val < profile.minValue) return false;
            if (profile.maxValue && profile.maxValue > 0 && val > profile.maxValue) return false;
            if (cpvPrefixes.length) {
                const cpvList = (o.cpvs||"").split(",").map(c=>c.trim());
                if (!cpvPrefixes.some(p => cpvList.some(c => c.startsWith(p)))) return false;
            }
            if (keywords.length) {
                const hay = ((o.title||"")+" "+(o.description||"")).toLowerCase();
                if (!keywords.some(k => hay.includes(k))) return false;
            }
            if (stages.length) {
                const stg = (o.stage||"").toLowerCase();
                if (!stages.some(s => stg.includes(s))) return false;
            }
            if (buyerKeywords.length) {
                const b = (o.buyer||"").toLowerCase();
                if (!buyerKeywords.some(k => b.includes(k))) return false;
            }
            return true;
        });
    }

    function buildDashCard(o, profileId, index) {
        const srcKey   = o._src || "fat";
        const srcClass = `dash-src-${srcKey}`;
        const srcLabel = DASH_SRC_LABELS[srcKey] || srcKey;
        const val      = o.value ? "£" + Number(o.value).toLocaleString("en-GB") : "—";
        const url      = o.source_url || "#";
        const cardId   = "dc-" + (o.id||"").replace(/[^a-z0-9]/gi,"");
        const profAttr = profileId ? `data-profile="${profileId}" data-idx="${index}"` : "";
        return `
        <div class="dash-card" ${profAttr}>
            <div class="dash-card-title">
                <a href="${esc(url)}" target="_blank" rel="noopener">${esc(o.title||"Untitled")}</a>
            </div>
            <div class="dash-card-meta">
                <span>${esc(o.buyer||"—")}</span>
                <span>${val}</span>
                <span class="dash-tag">${esc(o.stage||"—")}</span>
                <span class="dash-src-badge ${srcClass}">${srcLabel}</span>
                ${o.cpvs ? `<span style="font-size:0.68rem;color:#aaa;">${esc(o.cpvs.split(",").slice(0,3).join(", "))}</span>` : ""}
            </div>
            <div class="dash-card-desc" id="${cardId}" onclick="this.classList.toggle('expanded')">${esc(o.description||"")}</div>
            <div class="dash-card-footer">
                <div class="dash-ai-card">
                    <span class="dash-ai-card-label">⚡ AI:</span>
                    <span>— not yet configured —</span>
                </div>
                ${profileId !== undefined
                    ? `<button class="dash-view-btn" onclick="openDashFullscreen('${profileId}',${index})">Full View</button>`
                    : ""}
            </div>
        </div>`;
    }

    // -- Config modal --
    function openDashConfig() {
        resetDashForm();
        renderDashConfigList();
        document.getElementById("dash-config-modal").classList.remove("hidden");
        buildSwatches(document.getElementById("dash-form-color").value);
    }
    function closeDashConfig() {
        document.getElementById("dash-config-modal").classList.add("hidden");
        renderDashDay();
    }

    function buildSwatches(selectedColor) {
        document.getElementById("dash-swatch-row").innerHTML = DASH_SWATCHES.map(c =>
            `<div class="dash-swatch${c===selectedColor?" selected":""}"
                  style="background:${c}"
                  onclick="selectSwatch('${c}')"></div>`
        ).join("");
    }
    function selectSwatch(color) {
        document.getElementById("dash-form-color").value = color;
        buildSwatches(color);
    }

    function renderDashConfigList() {
        const profiles = _loadDashProfiles();
        const el = document.getElementById("dash-profile-list");
        if (!profiles.length) {
            el.innerHTML = "<div class='dash-empty'>No profiles yet.</div>";
            return;
        }
        el.innerHTML = profiles.map(p => {
            const srcs = (p.sources||[]).map(s=>({fat:"FaT",cf:"CF",pcs:"PCS"}[s]||s)).join(", ");
            const cpvs = (p.cpvPrefixes||[]).join(", ") || "any CPV";
            return `
            <div class="dash-profile-row">
                <div class="dash-profile-color-dot" style="background:${p.color||"#4a90d9"}"></div>
                <div style="flex:1">
                    <div class="dash-profile-row-name">${esc(p.name)}</div>
                    <div class="dash-profile-row-sub">${srcs} · CPV: ${cpvs}</div>
                </div>
                <button class="dash-edit-btn" onclick="editDashProfile('${p.id}')">Edit</button>
                <button class="dash-del-btn"  onclick="deleteDashProfile('${p.id}')">Delete</button>
            </div>`;
        }).join("");
    }

    function editDashProfile(id) {
        const p = _loadDashProfiles().find(x => x.id === id);
        if (!p) return;
        document.getElementById("dash-form-id").value    = p.id;
        document.getElementById("dash-form-name").value  = p.name;
        document.getElementById("dash-form-color").value = p.color || "#4a90d9";
        document.getElementById("dash-form-cpv").value   = (p.cpvPrefixes||[]).join(", ");
        document.getElementById("dash-form-kw").value    = (p.keywords||[]).join(", ");
        document.getElementById("dash-form-min").value   = p.minValue || "";
        document.getElementById("dash-form-max").value   = p.maxValue || "";
        document.getElementById("dash-form-stages").value = (p.stages||[]).join(", ");
        document.getElementById("dash-form-buyer").value = (p.buyerKeywords||[]).join(", ");
        document.querySelectorAll(".dash-src-chk").forEach(chk => {
            chk.checked = (p.sources||["fat","cf","pcs"]).includes(chk.value);
        });
        buildSwatches(p.color || "#4a90d9");
        document.getElementById("dash-form-title").textContent = "Edit Account";
    }

    function resetDashForm() {
        document.getElementById("dash-form-id").value     = "";
        document.getElementById("dash-form-name").value   = "";
        document.getElementById("dash-form-color").value  = DASH_SWATCHES[0];
        document.getElementById("dash-form-cpv").value    = "";
        document.getElementById("dash-form-kw").value     = "";
        document.getElementById("dash-form-min").value    = "";
        document.getElementById("dash-form-max").value    = "";
        document.getElementById("dash-form-stages").value = "";
        document.getElementById("dash-form-buyer").value  = "";
        document.querySelectorAll(".dash-src-chk").forEach(chk => chk.checked = true);
        document.getElementById("dash-form-title").textContent = "Add Account";
    }

    function saveDashProfile() {
        const name = document.getElementById("dash-form-name").value.trim();
        if (!name) { alert("Please enter a profile name."); return; }
        const id      = document.getElementById("dash-form-id").value || String(Date.now());
        const color   = document.getElementById("dash-form-color").value;
        const sources = [...document.querySelectorAll(".dash-src-chk:checked")].map(c => c.value);
        const split   = s => s.split(",").map(x=>x.trim()).filter(Boolean);
        const profile = {
            id, name, color, sources,
            cpvPrefixes:   split(document.getElementById("dash-form-cpv").value),
            keywords:      split(document.getElementById("dash-form-kw").value),
            minValue:      parseFloat(document.getElementById("dash-form-min").value) || 0,
            maxValue:      parseFloat(document.getElementById("dash-form-max").value) || 0,
            stages:        split(document.getElementById("dash-form-stages").value),
            buyerKeywords: split(document.getElementById("dash-form-buyer").value),
        };
        const profiles = _loadDashProfiles();
        const idx = profiles.findIndex(p => p.id === id);
        if (idx >= 0) profiles[idx] = profile; else profiles.push(profile);
        _saveDashProfiles(profiles);
        resetDashForm();
        renderDashConfigList();
    }

    function deleteDashProfile(id) {
        if (!confirm("Delete this profile?")) return;
        _saveDashProfiles(_loadDashProfiles().filter(p => p.id !== id));
        renderDashConfigList();
    }

    // =====================
    // CONFIG PANEL
    // =====================
    const CFG_KEY = 'dxc_ai_config';
    const CFG_OFF_KEY = 'dxc_ai_config_offerings';

    // Per-offering data store (keyed by viewId)
    const _cfgOffData = { security: {}, cloud: {}, workplace: {}, network: {} };
    let _cfgActiveOff = 'security';

    function openConfig() {
        document.getElementById('cfg-overlay').classList.remove('hidden');
        cfgLoad();
    }
    function closeConfig() {
        document.getElementById('cfg-overlay').classList.add('hidden');
    }

    function cfgLoad() {
        const saved = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
        const setText = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
        setText('cfg-company-overview', saved.companyOverview);
        setText('cfg-differentiators',  saved.differentiators);
        setText('cfg-exclusions',        saved.exclusions);
        setText('cfg-min-value',         saved.minValue);
        setText('cfg-tone',              saved.tone);
        setText('cfg-sectors',           saved.sectors);
        setText('cfg-sensitivity',       saved.sensitivity);
        setText('cfg-endpoint',          saved.endpoint);
        setText('cfg-user-name',         saved.userName);
        setText('cfg-user-role',         saved.userRole);
        setText('cfg-team',              saved.team);
        setText('cfg-default-view',      saved.defaultView);
        setText('cfg-thresh-security',   saved.threshSecurity);
        setText('cfg-thresh-cloud',      saved.threshCloud);
        setText('cfg-thresh-workplace',  saved.threshWorkplace);
        setText('cfg-thresh-network',    saved.threshNetwork);

        // Seed defaults if not yet set
        const kaEl = document.getElementById('cfg-known-accounts');
        if (kaEl) kaEl.value = saved.knownAccounts !== undefined ? saved.knownAccounts
            : 'NHS England\nHMRC\nMinistry of Defence\nCabinet Office\nHome Office';
        const taEl = document.getElementById('cfg-target-accounts');
        if (taEl) taEl.value = saved.targetAccounts !== undefined ? saved.targetAccounts
            : 'DWP | 5000000\nDVLA | 2000000\nHM Treasury | 3000000\nDept for Transport | 2000000';

        const offSaved = JSON.parse(localStorage.getItem(CFG_OFF_KEY) || '{}');
        ['security','cloud','workplace','network'].forEach(v => {
            _cfgOffData[v] = offSaved[v] || {};
        });
        switchCfgOffering(_cfgActiveOff, document.querySelector(`.cfg-otab[onclick*="'${_cfgActiveOff}'"]`));
    }

    function cfgSaveAll() {
        // Save current offering panel before persisting
        _cfgSaveCurrentOff();

        const getVal = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
        const data = {
            companyOverview:  getVal('cfg-company-overview'),
            differentiators:  getVal('cfg-differentiators'),
            exclusions:       getVal('cfg-exclusions'),
            minValue:         getVal('cfg-min-value'),
            tone:             getVal('cfg-tone'),
            sectors:          getVal('cfg-sectors'),
            sensitivity:      getVal('cfg-sensitivity'),
            endpoint:         getVal('cfg-endpoint'),
            userName:         getVal('cfg-user-name'),
            userRole:         getVal('cfg-user-role'),
            team:             getVal('cfg-team'),
            defaultView:      getVal('cfg-default-view'),
            knownAccounts:    getVal('cfg-known-accounts'),
            targetAccounts:   getVal('cfg-target-accounts'),
            threshSecurity:   getVal('cfg-thresh-security')  || '2000000',
            threshCloud:      getVal('cfg-thresh-cloud')     || '3000000',
            threshWorkplace:  getVal('cfg-thresh-workplace') || '1000000',
            threshNetwork:    getVal('cfg-thresh-network')   || '2000000',
        };
        localStorage.setItem(CFG_KEY, JSON.stringify(data));
        localStorage.setItem(CFG_OFF_KEY, JSON.stringify(_cfgOffData));
        _cfgShowToast();
    }

    function _cfgSaveCurrentOff() {
        const getVal = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
        _cfgOffData[_cfgActiveOff] = {
            focus:       getVal('cfg-off-focus'),
            caps:        getVal('cfg-off-caps'),
            competitors: getVal('cfg-off-competitors'),
            winthemes:   getVal('cfg-off-winthemes'),
        };
    }

    function switchCfgOffering(viewId, btn) {
        _cfgSaveCurrentOff();
        _cfgActiveOff = viewId;
        document.querySelectorAll('.cfg-otab').forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');
        const d = _cfgOffData[viewId] || {};
        const setText = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
        setText('cfg-off-focus',       d.focus);
        setText('cfg-off-caps',        d.caps);
        setText('cfg-off-competitors', d.competitors);
        setText('cfg-off-winthemes',   d.winthemes);
    }

    function cfgFileSelected(input, key) {
        if (!input.files || !input.files[0]) return;
        const name = input.files[0].name;
        const nameEl = document.getElementById(`cfg-file-${key}-name`);
        if (nameEl) { nameEl.textContent = name; nameEl.style.display = 'block'; }
        input.closest('.cfg-upload-zone').classList.add('has-file');
    }

    function _cfgShowToast() {
        const t = document.getElementById('cfg-toast');
        if (!t) return;
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 2400);
    }

    // =====================
    // ROUTING + SCORING
    // =====================
    const _ROUTE_META = {
        current_account:    { label: 'Account',   cls: 'route-account'  },
        target_significant: { label: 'Target ★',  cls: 'route-target-s' },
        target_small:       { label: 'Target',    cls: 'route-target-x' },
        pursuit_team:       { label: 'Pursuit',   cls: 'route-pursuit'  },
        too_small:          { label: 'Too Small', cls: 'route-small'    },
        no_dxc_offering:    { label: 'No Match',  cls: 'route-no-match' },
    };

    const _OFFERING_CPV = {
        security:  ['72.2','72.7','72600','72700'],
        cloud:     ['72200','72300','72400','72500'],
        workplace: ['72','48','30'],
        network:   ['32','34.9'],
    };

    const _OFFERING_KW = {
        security:  ['security','cyber','soc','siem','threat','firewall','endpoint'],
        cloud:     ['cloud','azure','aws','iaas','paas','migration','platform engineering'],
        workplace: ['workplace','desktop','end user','eud','device','vdi','collaboration','unified comms'],
        network:   ['network','telecoms','connectivity','infrastructure','wan','lan'],
    };

    let _routeFilter = new Set();

    function _getRoutingConfig() {
        const cfg = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
        const knownAccounts  = (cfg.knownAccounts  || 'NHS England\nHMRC\nMinistry of Defence\nCabinet Office\nHome Office')
            .split('\n').map(s => s.trim()).filter(Boolean);
        const targetAccounts = (cfg.targetAccounts || 'DWP | 5000000\nDVLA | 2000000\nHM Treasury | 3000000\nDept for Transport | 2000000')
            .split('\n').map(s => s.trim()).filter(Boolean);
        const thresholds = {
            security:  parseFloat(cfg.threshSecurity  || '2000000'),
            cloud:     parseFloat(cfg.threshCloud     || '3000000'),
            workplace: parseFloat(cfg.threshWorkplace || '1000000'),
            network:   parseFloat(cfg.threshNetwork   || '2000000'),
        };
        return { knownAccounts, targetAccounts, thresholds };
    }

    function classifyOpp(o) {
        const { knownAccounts, targetAccounts, thresholds } = _getRoutingConfig();
        const buyer = (o.buyer || '').toLowerCase();
        const value = parseFloat(o.value) || 0;
        const cpvs  = (o.cpvs  || '').toLowerCase();
        const hay   = ((o.title || '') + ' ' + (o.description || '')).toLowerCase();

        for (const line of knownAccounts) {
            const name = line.split('|')[0].trim().toLowerCase();
            if (name && buyer.includes(name)) return 'current_account';
        }
        for (const line of targetAccounts) {
            const parts  = line.split('|');
            const name   = parts[0].trim().toLowerCase();
            const thresh = parseFloat((parts[1] || '').replace(/[^0-9.]/g, '')) || 0;
            if (name && buyer.includes(name))
                return value >= thresh ? 'target_significant' : 'target_small';
        }

        // Offering match — CPV first, then keyword fallback
        const matchedOffering = Object.entries(_OFFERING_CPV).find(([, pfx]) =>
            pfx.some(p => cpvs.includes(p))
        ) || Object.entries(_OFFERING_KW).find(([, kws]) =>
            kws.some(k => hay.includes(k))
        );
        if (!matchedOffering) return 'no_dxc_offering';
        const minVal = thresholds[matchedOffering[0]] || 0;
        if (value && value < minVal) return 'too_small';
        return 'pursuit_team';
    }

    function placeholderScore(o) {
        const routing = classifyOpp(o);
        if (routing !== 'pursuit_team' && routing !== 'target_significant') return null;
        const value = parseFloat(o.value) || 0;
        const score = Math.min(10, Math.max(1, Math.round(value / 5_000_000) + 5));
        const rec   = score >= 7 ? 'PURSUE' : score >= 4 ? 'QUALIFY' : 'PASS';
        const reasoning =
            rec === 'PURSUE'  ? `Strong value alignment — recommend progressing to pursuit team review.` :
            rec === 'QUALIFY' ? `Value within range — qualification call recommended before committing resource.` :
                                `Low contract value relative to offering thresholds — assess strategic fit before pursuing.`;
        return { score, rec, reasoning };
    }

    function routingBadgeHtml(routing) {
        if (!routing) return '';
        const m = _ROUTE_META[routing];
        if (!m) return '';
        return `<span class="route-chip ${m.cls}">${m.label}</span>`;
    }

    function scoreBadgeHtml(scoreObj) {
        if (!scoreObj) return '';
        const cls = scoreObj.rec === 'PURSUE' ? 'score-pursue' : scoreObj.rec === 'QUALIFY' ? 'score-qualify' : 'score-pass';
        return `<span class="score-badge ${cls}" title="${scoreObj.rec}: ${scoreObj.reasoning}">${scoreObj.score}</span>`;
    }

    function applyRouteFilter() {
        _routeFilter = new Set(
            [...document.querySelectorAll('#route-checkboxes input:checked')].map(cb => cb.value)
        );
        renderTable(currentData);
    }

    // =====================
    // INIT
    // =====================
    fetchAndRender();
    loadTriageSessions();
    ["fat","cf","pcs"].forEach(s => renderSavedSearches(s));
