'use strict';
// Starting objectives tree (from the business plan). Ayqan can edit all of it from the Objectives tab.
let i = 0;
const n = (title, text, children = []) => ({ id: 's' + (++i), title, text, children });

const OUTREACH_TARGETS = 'Daily: scrape and qualify 100 leads (25 for email, 25 dm, 50 for calls), send 50 contacts, answer replies in 2 hours\nWeekly: 500 leads, 250 contacts, 6 replies, 2 booked calls\nMonthly: 2,000 leads, 1,000 contacts, 24 replies, 8 booked calls';
const OUTREACH_GOAL = '1. Book 24 calls by day 90 from 3,000 emails and DMs.\n2. Scrape and qualify 6,000 leads by day 90 (3,000 for email & dm, 3,000 for calls).';
const BUILD_TARGETS = 'Daily: log build progress on the board\nWeekly: move every open build forward one milestone\nMonthly: 1 to 2 client builds live';

const SEED_TREE = n('Main objective', 'Sign 6 to 8 paying clients and get their builds live on time by day 90.', [
  n('Division: Operations', 'Win 6 to 8 clients and get their builds live on time.', [
    n('Department: Outreach', 'Book 60 calls from 6,000 contacts by day 90.', [
      n('Yaseen', OUTREACH_GOAL, [n('Targets', OUTREACH_TARGETS)]),
      n('Ehtesham', OUTREACH_GOAL, [n('Targets', OUTREACH_TARGETS)]),
      n('Ayqan', 'Make 6,000 dials in 90 days.', [n('Targets', 'Daily: 100 dials, every call logged\nWeekly: 500 dials, 1 booked call\nMonthly: about 2,000 dials, 4 booked calls')]),
      n('Cold caller (open position)', 'Make 50 dials a day from the day you join, which takes half of Ayqan’s 100.', [n('Targets', 'Daily: 50 dials, every call logged\nWeekly: 250 dials\nMonthly: about 1,000 dials')]),
    ]),
    n('Department: Building', 'Get 8 client builds live by day 90, each within 5 days of payment.', [
      n('Saad', 'Get 4 client builds live by day 90, each within 5 days of payment.', [n('Targets', BUILD_TARGETS)]),
      n('Ayqan (builder)', 'Get 4 client builds live by day 90, each within 5 days of payment.', [n('Targets', BUILD_TARGETS)]),
    ]),
  ]),
  n('Division: Marketing', 'Bring in 10 inbound enquiries by day 90 and publish 1 case study by day 60.', [
    n('Department: Social', 'Publish 36 posts, 10 videos and 23 motion graphics by day 90.', [
      n('Ayqan', 'Deliver 36 posts, 10 videos and 3 motion graphics by day 90.', [n('Targets', 'Weekly: 3 posts, about 1 video\nMonthly: 12 posts, 3 to 4 videos, 1 motion graphic')]),
      n('Saad (motion)', 'Deliver 20 motion graphics for posts by day 90.', [n('Targets', 'Weekly: 1 to 2 motion designs\nMonthly: 6 to 7 motion designs')]),
    ]),
    n('Department: Website', 'Put the portfolio page live by day 14 and the case study page by day 60.', [
      n('Ayqan (builds)', 'Build the portfolio page by day 14 and the case study page by day 60.', [n('Targets', 'Weekly: 1 website milestone\nDay 14: portfolio page live\nDay 60: case study page live')]),
      n('Saad (manages)', 'Make 1 website update every week for 12 weeks.', [n('Targets', 'Weekly: 1 website update\nMonthly: 4 website updates')]),
    ]),
  ]),
  n('Division: Human Resources', 'Train the team so everyone passes role tests by week 4 and is appraised every month.', [
    n('Department: Training and appraisal', 'Run 12 training sessions (1 a week) and appraise everyone monthly.', [
      n('Ayqan', 'Create systems to make jobs easier for all. Create training programs for individuals.', [n('Targets', 'Weekly: 1 training session (30 minutes)\nMonthly: 4 sessions, 1 appraisal per person\nBy week 2: demo build and call script written as procedures')]),
    ]),
  ]),
  n('Division: Finance', 'Close the books by day 5 of each month and pay everyone on the fixed day, from collected money only.', [
    n('Department: Accounting & Financial Forecast', 'Forecast Finances, Record Finances', [
      n('Ayqan', 'Record every payment and bill within 2 days and share a 3-month forecast by day 5 of each month.', [n('Targets', 'Weekly: every payment and bill recorded within 2 days\nMonthly: books closed and forecast shared by day 5\nCheck: payouts + team fund + direct costs = money collected')]),
    ]),
  ]),
]);

module.exports = { SEED_TREE };
