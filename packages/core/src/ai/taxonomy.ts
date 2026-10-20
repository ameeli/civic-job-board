/** What the job is: one per job. */
export const JOB_FUNCTIONS = [
  "Software Engineering",
  "Data/Analytics",
  "Design/UX/Research",
  "Product",
  "Program/Project Mgmt",
  "Policy/Legal",
  "Ops/Finance/People",
  "Sales/Partnerships/Fundraising",
  "Executive",
  "Fellowship/Internship",
] as const;

/** Where the work has impact: one or more per job. */
export const SECTORS = [
  "Government/Public sector",
  "Civic tech/GovTech vendor",
  "Democracy/Elections",
  "Climate/Energy",
  "Health",
  "Education",
  "Justice/Rights",
  "Economic opportunity",
  "Humanitarian/International",
  "Other social impact",
  "Not impact",
] as const;

export const SENIORITIES = [
  "Intern",
  "Entry",
  "Mid",
  "Senior",
  "Lead/Principal",
  "Manager",
  "Director",
  "Executive",
] as const;

export type JobFunction = (typeof JOB_FUNCTIONS)[number];
export type Sector = (typeof SECTORS)[number];
export type Seniority = (typeof SENIORITIES)[number];
