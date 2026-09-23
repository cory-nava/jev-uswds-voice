#!/usr/bin/env python3
"""
Builds lib/templates/*.json — the sample pages that "create a page from the
… template" copies and that Reset restores. Structure follows common
federal-site patterns (banner, header, hero, top tasks, help, footer;
sign-in with account and help sections; dashboard with side nav) for the
fictional Benefit Tracker service. Run: python3 scripts/build-templates.py
"""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "lib" / "templates"


class Page:
    def __init__(self, page_id, title):
        self.page_id, self.title, self.n = page_id, title, 0

    def node(self, type_, props, children=None):
        self.n += 1
        node = {"id": f"n{self.n}", "type": type_, "props": props}
        if children:
            node["children"] = children
        return node

    def save(self, nodes):
        spec = {"pageId": self.page_id, "title": self.title, "nodes": nodes, "nextId": self.n + 1}
        (OUT / f"{self.page_id}.json").write_text(json.dumps(spec, indent=2) + "\n")


NAV = [("Programs", "/marketing#programs"), ("Check status", "/dashboard"), ("Get help", "/marketing#help"), ("Sign in", "/signin")]


def chrome_top(p, current=None):
    return [
        p.node("GovBanner", {"tld": ".gov", "expanded": False}),
        p.node("SiteAlert", {"heading": "Demonstration site", "message": "Benefit Tracker is a fictional service built by voice. Don't enter real personal information.", "type": "info", "slim": True}),
        p.node("Header", {
            "variant": "basic", "siteName": "Benefit Tracker", "siteUrl": "/marketing", "logoUrl": None, "logoAlt": None,
            "navItems": [{"label": l, "href": h, "current": l == current, "items": None} for l, h in NAV],
            "showSearch": False,
        }),
    ]


def footer(p, variant="medium"):
    return p.node("Footer", {
        "variant": variant, "agencyName": "Benefit Tracker", "agencyUrl": "/marketing", "logoUrl": None, "logoAlt": None,
        "navGroups": [{"heading": None, "links": [
            {"label": "Programs", "href": "/marketing#programs"}, {"label": "Check status", "href": "/dashboard"},
            {"label": "Get help", "href": "/marketing#help"}, {"label": "Accessibility", "href": "/marketing#accessibility"},
            {"label": "Privacy", "href": "/marketing#privacy"},
        ]}],
        "contactHeading": "Benefit Tracker help desk" if variant != "slim" else None,
        "contactInfo": [{"type": "phone", "value": "(555) 010-0199"}, {"type": "email", "value": "help@benefit-tracker.example"}] if variant != "slim" else None,
        "socialLinks": [], "returnToTop": variant != "slim",
    })


def side_nav(p):
    items = [("Overview", "/dashboard"), ("Applications", "/dashboard#applications"), ("Documents", "/dashboard#documents"), ("Messages", "/dashboard#messages"), ("Profile", "/profile")]
    return p.node("SideNav", {"ariaLabel": "Account navigation"}, [
        p.node("Link", {"label": l, "href": h, "external": None, "variant": None}) for l, h in items
    ])


def card(p, title, description, label, href):
    return p.node("Card", {"title": title, "description": description, "headerFirst": None, "mediaUrl": None, "mediaAlt": None, "flag": None},
                  [p.node("Button", {"label": label, "variant": "default", "disabled": False, "type": "button", "href": href})])


def marketing():
    p = Page("marketing", "Benefit Tracker — Track your benefits in one place")
    nodes = chrome_top(p) + [
        p.node("Hero", {"heading": "Track your benefits in one place", "eyebrow": None,
                        "body": "One secure account for food assistance, health coverage, housing help, and more.",
                        "backgroundUrl": None, "ariaLabel": "Introduction"}),
        p.node("Heading", {"text": "Top tasks", "level": "h2"}),
        p.node("CardGroup", {}, [
            card(p, "Apply for benefits", "Answer a few questions once and apply to several programs at the same time.", "Start an application", "/signin"),
            card(p, "Check your status", "See where each application stands and what you need to do next.", "Check status", "/dashboard"),
            card(p, "Get text reminders", "Get a text when a deadline is coming up or a decision is made.", "Sign up for texts", "/profile"),
        ]),
        p.node("Heading", {"text": "Explore programs", "level": "h2"}),
        p.node("Collection", {"items": [
            {"heading": h, "href": f"/marketing#{h.lower().replace(' ', '-')}", "description": d, "date": None, "dateLabel": None, "tags": None, "thumbnailUrl": None, "thumbnailAlt": None}
            for h, d in [
                ("Food assistance", "Help buying groceries for you and your household."),
                ("Health coverage", "Free or low-cost health insurance, including for children."),
                ("Housing help", "Rental assistance and help avoiding eviction."),
                ("Child care", "Help paying for child care while you work or go to school."),
                ("Energy bills", "Help with heating and cooling costs."),
                ("Job training", "Free training, apprenticeships, and career counseling."),
            ]]}),
        p.node("SummaryBox", {"heading": "Need help?", "items": [
            "Call the help desk at (555) 010-0199, Monday to Friday, 8 a.m. to 6 p.m.",
            "Chat with us online after you sign in.",
            "Visit a local office to apply in person.",
        ]}),
        footer(p),
    ]
    p.save(nodes)


def signin():
    p = Page("signin", "Sign in — Benefit Tracker")
    nodes = chrome_top(p, current="Sign in") + [
        p.node("Heading", {"text": "Sign in", "level": "h1"}),
        p.node("Text", {"text": "Sign in to check your applications, upload documents, and update your contact information.", "variant": "lead"}),
        p.node("Form", {"large": False}, [
            p.node("Input", {"label": "Email address", "name": "email", "type": "email", "placeholder": None, "hint": None, "value": None, "required": True, "disabled": None, "checks": None, "validateOn": None}),
            p.node("Password", {"label": "Password", "name": "password", "hint": None, "value": None, "required": True, "checks": None, "validateOn": None}),
            p.node("Checkbox", {"label": "Keep me signed in on this device", "name": "remember", "hint": None, "checked": None, "tile": None, "checks": None, "validateOn": None}),
            p.node("Button", {"label": "Sign in", "variant": "default", "disabled": False, "type": "submit"}),
        ]),
        p.node("Link", {"label": "Forgot your password?", "href": "/signin#reset", "external": None, "variant": None}),
        p.node("Divider", {}),
        p.node("Heading", {"text": "Don't have an account?", "level": "h2"}),
        p.node("Text", {"text": "Create an account to apply for benefits and track every application in one place.", "variant": "body"}),
        p.node("Button", {"label": "Create an account", "variant": "outline", "disabled": False, "type": "button", "href": "/signin#create"}),
        p.node("Heading", {"text": "Having trouble signing in?", "level": "h2"}),
        p.node("Text", {"text": "Call the help desk at (555) 010-0199. We're here Monday to Friday, 8 a.m. to 6 p.m.", "variant": "body"}),
        footer(p),
    ]
    p.save(nodes)


def dashboard():
    p = Page("dashboard", "Your applications — Benefit Tracker")
    nodes = chrome_top(p, current="Check status") + [
        side_nav(p),
        p.node("Heading", {"text": "Your applications", "level": "h1"}),
        p.node("Text", {"text": "Welcome back. Here's where each of your applications stands.", "variant": "lead"}),
        p.node("Alert", {"heading": "Action needed", "message": "Upload proof of income for your food assistance application by May 30.", "type": "warning", "slim": False, "noIcon": False}),
        p.node("Table", {"columns": ["Program", "Status", "Last updated"], "rows": [
            ["Food assistance", "Documents needed", "May 12"], ["Health coverage", "In review", "May 8"], ["Housing help", "Approved", "April 22"],
        ], "caption": "Applications", "borderless": None, "striped": True, "compact": None, "scrollable": None}),
        p.node("Heading", {"text": "Health coverage application", "level": "h2"}),
        p.node("StepIndicator", {"steps": ["Submitted", "In review", "Decision"], "currentStep": 2, "counters": None, "centered": None, "noLabels": None}),
        p.node("Heading", {"text": "Quick actions", "level": "h2"}),
        p.node("ButtonGroup", {"segmented": False}, [
            p.node("Button", {"label": "Upload a document", "variant": "default", "disabled": False, "type": "button", "href": "/dashboard#documents"}),
            p.node("Button", {"label": "Start a new application", "variant": "outline", "disabled": False, "type": "button", "href": "/dashboard#apply"}),
        ]),
        footer(p),
    ]
    p.save(nodes)


def profile():
    p = Page("profile", "Edit your profile — Benefit Tracker")
    nodes = chrome_top(p) + [
        side_nav(p),
        p.node("Heading", {"text": "Edit your profile", "level": "h1"}),
        p.node("Text", {"text": "We use this information to contact you about your applications.", "variant": "lead"}),
        p.node("Form", {"large": False}, [
            p.node("Input", {"label": "Full name", "name": "fullname", "type": "text", "placeholder": None, "hint": "As it appears on your ID", "value": None, "required": True, "disabled": None, "checks": None, "validateOn": None}),
            p.node("DateInputGroup", {"label": "Date of birth", "name": "dob", "hint": "For example: January 19 2000", "required": True, "monthValue": None, "dayValue": None, "yearValue": None}),
            p.node("Input", {"label": "Phone number", "name": "phone", "type": "tel", "placeholder": None, "hint": "Include your area code", "value": None, "required": None, "disabled": None, "checks": None, "validateOn": None}),
            p.node("Input", {"label": "Email address", "name": "email", "type": "email", "placeholder": None, "hint": None, "value": None, "required": True, "disabled": None, "checks": None, "validateOn": None}),
            p.node("Radio", {"legend": "How should we contact you?", "name": "contact", "options": [
                {"label": "Email", "value": "email", "hint": None}, {"label": "Phone call", "value": "phone", "hint": None}, {"label": "Text message", "value": "text", "hint": None},
            ], "tile": None, "value": None, "checks": None, "validateOn": None}),
            p.node("Checkbox", {"label": "Send me text reminders about deadlines", "name": "reminders", "hint": None, "checked": None, "tile": None, "checks": None, "validateOn": None}),
            p.node("ButtonGroup", {"segmented": False}, [
                p.node("Button", {"label": "Save", "variant": "default", "disabled": False, "type": "submit"}),
                p.node("Button", {"label": "Cancel", "variant": "outline", "disabled": False, "type": "button"}),
            ]),
        ]),
        footer(p),
    ]
    p.save(nodes)


if __name__ == "__main__":
    for build in (marketing, signin, dashboard, profile):
        build()
    print("wrote", ", ".join(sorted(f.name for f in OUT.glob("*.json"))))
