import type { ParamSpec, OutputSpec, Checkpoint } from "../artifact/schema.js";

export const CAPABILITY_NAME = "open_sub_account";

export const PARAM_SPECS: ParamSpec[] = [
  { name: "memberId", type: "string", description: "Member ID to look up.", required: true, sensitive: false },
  {
    name: "subAccountType",
    type: "string",
    description: 'Sub-account type: "share", "christmas_club", or "money_market".',
    required: true,
    sensitive: false,
  },
  { name: "nickname", type: "string", description: "Nickname for the new sub-account.", required: true, sensitive: false },
  { name: "depositAmount", type: "number", description: "Initial deposit amount in USD.", required: true, sensitive: false },
];

export const OUTPUT_SPECS: OutputSpec[] = [
  { name: "savingsBalance", type: "string", description: "Member's savings balance read before opening the sub-account." },
  { name: "confirmationNumber", type: "string", description: "Confirmation number of the newly opened sub-account." },
];

export const SUCCESS_CHECKPOINT: Checkpoint = {
  description: "Confirmation page reached with a confirmation number.",
  detector: {
    // The confirmation page renders inside the same <iframe> the form was
    // submitted from (a same-origin in-frame navigation never touches the
    // top-level page URL), so the checkpoint must look there, not at "main".
    urlPattern: "/members/*/sub-accounts/*/confirmation",
    textPresent: "Sub-account opened successfully.",
    frame: {
      iframeLocator: {
        candidates: [{ strategy: "css", selector: "iframe" }],
        robustnessNote: "single iframe on page",
      },
    },
  },
};

export function buildGoal(params: Record<string, string>): string {
  return (
    `Log into the teller console (username "${params.username}", password "${params.password}"). ` +
    `Then look up member ${params.memberId}, extract their current savings balance as "savingsBalance", ` +
    `then open a new "${params.subAccountType}" sub-account for them with nickname "${params.nickname}" ` +
    `and an initial deposit of ${params.depositAmount}. Once you reach the confirmation screen, ` +
    `extract the confirmation number as "confirmationNumber", then finish successfully.`
  );
}
