# Prompts

A record of prompts used while building this project.

---

## Prompt #11: Minor UI/Logic Fixes: Query Log Tooltip & Scan Threshold

> MINOR UI/LOGIC FIXES; Fix the tooltip issue when you hover over the Query log. The tooltip stays within the rendered sidebar component; the tooltip should have a higher z-index and appear on top of the sidebar and any other text in the way. Also, decrease the scan intensity threshold to avoid issues where thresholds aren't met, and all queries are labeled as uncertain.

---

## Prompt #10: Session Query Sidebar, Stats & Retry

> I want to include past queries for the application. On the left side open a bar that shows the past queries in this session (warn the user that the queries that they will receive are not persistent throughout refreshes or new instances of the app). Then, keep track of all the output stats from the link, and add in a new query entry to the side whenever you do a new request. Add a new button to each page for a re-try to try again if you need to, and when you start add a new entry on the left that says loading with the overall progress as the same pie chart format on the left with the name of the website title. On hover you can see condensed details on the site using the tooltip component we added earlier, to make it look really professional and well made. You should be able to toggle this panel if you don't want to see it as well, but it should be there on by default.

---

## Prompt #9: Pipeline Agents UI & Source Trust Filtering

> For the pipeline agents, I want you to change it so instead of a bar you have a pie chart icon to the left of the agent that is running, and for each pipeline agent I want you to list out all the tasks. If there are 42 tasks then add something where it shows a bunch of tasks and rotates, so if the first task is done then you move onto the next task like a vertical carousel, but it should show everything the backend is doing, even the small bits. Then what I want you to do is add something that checks the results from the API, to check that the sources are sites that can be trusted. For example, the majority of the sources right now are youtube, facebook, bbc (itself), instagram, and other news outlets which are very bad sources. Add a check that will ensure that one, no matter what the page can't be verified by a site from itself, and two the source is not a major social media platform or a platform with general bias to their statements. Look for official transcripts, articles that are stated to be true, etc. Ensure that the sources are accurate and trustworthy sources so our outputs can be too.

---

## Prompt #8: Frontend: Backend Integration & Live Dashboard

> Now that you have fixed the backend wrangler portion of the application, I want you to link the backend to the frontend. Currently when you type a link into the search bar there is no verification that the link is a link or can be accessed, so once I type in the link ensure to check that the link can be accessed then if it can't give an error but if it can then move into the dashboard and begin visualizing the process. Ensure no fake statistics are displayed and all the statistics that were templated in the UI are pulled and received directly from the backend workflow. What you need to do is display all the information in a statistically accurate manner while not calling extra api calls to the api linked or using inefficient methods to pull the data from the processes. If there is a better way to visualize the dashboard with more metrics add in the metrics so the user can see what is going on in the backend. Ensure the dashboard always shows what is going on and what WILL go on, so if there are processes that are GOING to happen ensure to add them as well but with a different UI marker. Animate anything you can to make everything feel smooth and buttery, so things feel flowing and polished in terms of UI. Maintain aesthetics and efficiency.

---

## Prompt #7: Pipeline: HTML Entities, Lenient JSON, LLM Search Queries

> Fix two existing issues and add one new step to the pipeline. First, decode HTML entities in the text extraction step so encoded characters like &quot; and &#x27; are converted to actual characters before processing. Second, make the JSON parsing more lenient to handle cases where the model wraps its response in markdown or extra text, and add logging of the raw AI response so we can see what it returns. Third, add a new step to the pipeline before each Tavily search where the claim and the article title and context are sent to the LLM first, asking it to generate 2 to 3 short focused search queries for that claim. Use those generated queries for the Tavily search instead of the raw claim text.

---

## Prompt #6: Worker: Background URL Analysis (Tavily + Llama 3.3)

> Now let's write in the actual analysis portion. When a POST jobs request comes in, after creating the job (when someone submits the URL) make the worker start a background task that fetches the submitted URL, so accesses the URL and its contents, extracts only the readable text from the page, take out all the HTML tags, scripts, navigation and any other elements like the footer or images. Then split the text into individual sentence level claims, take out anything that is too short. For each claim that was extracted, first search the Tavily API with the claim as the query to retrieve real web sources and evidence. Then put both the claim and the Tavily search results into Llama 3.3 on Workers AI, and ask it to evaluate whether the claim is true, false, or uncertain based on the evidence that was returned by Tavily. Store the Tavily API key as an environment secret var. Put the Tavily search logic in a separate file and call the file search.ts.

---

## Prompt #5: Cloudflare Worker: Durable Object Job Tracker

> Rewrite this cloudflare worker. You need to rewrite the Durable Object so that it acts as a job tracker that stores the status of a job, whether it is pending, processing, complete, or there was an error with the job, alongside storing the URL that was submitted to analyze and the array of claims that it returns as the results which contains the verdicts of true, false, or uncertain with an attached explanation. The durable object needs to have an internal GET route so that it can return the current state of the job, as well as a POST route to update the current job. The main Worker fetch handler should have 2 routes. One where the user submits a URL and gets back a job ID and another where the user can check the status and results of a job using that ID.

---

## Prompt #4: FactCheckDashboard: Monochrome Shadcn-Style Redesign

> Build a React dashboard component called FactCheckDashboard using Tailwind CSS for a fact checking web app called SiteSeer. The background is pure white with a subtle dot grid pattern made from a CSS radial gradient so it doesn't look too plain. The navbar at the top is white with a thin bottom border and has the plain text logo "SiteSeer" in normal black font on the left next to a small gray pill showing the URL that was checked, and a Check Another button on the far right. Under the navbar there are 4 cards in a row at the top: the first has a donut chart showing the overall credibility score percentage in black on a light gray circle, a label underneath saying how many claims it was based on, and a verdict text like "Mostly credible" in gray. The next three cards each have a big black number at the top, one for true claims, one for false, and one that can't be verified, each with a short description underneath. Below those four cards there are two cards side by side: the left one shows the active agents running with a pulsing dark live indicator in the corner, each agent has its name, a status message like "parsing article content", a thin dark progress bar, and a small pill that says running or idle. The right card shows the source domains that were used with a small horizontal dark bar next to each one showing how many times it was cited. At the bottom is a wide claims section with filter buttons across the top to filter by all, true, false, or unverifiable, and each claim has a small monochrome rounded badge for the verdict, the claim text in dark, a shorter explanation paragraph in gray under it, and gray pill-shaped source chips. Claims still being checked have a spinning circle and gray text. The entire UI is strictly black and white with no color — no green, red, amber, or blue anywhere. No percentage confidence bars on the claims. The component takes a result prop with the url, score, claims array and agents array and falls back to mock data if undefined. The design should represent a compact Shadcn-style professional dashboard aesthetic with tight spacing, subtle borders, and a data-forward presentation.

---

## Prompt #3: Dashboard View & Animated Transitions

> Once the user enters something in the search bar, new components will appear, but the background and everything will stay the same so it looks like components reordering animated. Each component will receive an entry animation starting from nothing and expanding into its component state. We should have the url we entered at the top (this should be a dashboard format so no more dots background). A button to the right of the link saying check another that will lead you back to the first page. then information about your specific result like Credibility score (some percent), a counter for true claims, a counter for false claims, and a counter for claims that were not able to be verified. then a tabbed list of all claims, true claims, false, and unverifiable claims so they are clearly distinct from each other. There should also be a UI that shows active agents if they are running using the multi-step loader component UI somewhere. All of this should be added without any functionality right now, but as a template so I can add functionality on top of everything.

---

## Prompt #2: Typography, Frosted Glass & Input Refinements

> Swap the Site-Seer font, and instead of SITESEER make it Site-Seer. Don't make the font that bold and obstructive. Give all the text components in the center a frosted glass background that allows the focus to stay on the center components while maintaining clarity and visibility of the background, so the view remains aesthetic. Increase the starting length of the input text box. Make all the subtext more visible with a darker color since on the dotted background it is difficult to see.

---

## Prompt #1: Initial Landing Page Design

> Lets start work on the front end design. Start with a white empty page and a interactive dot grid background. In the center we should have the title text which reads Siteseer in a big bold techy font. Use the existing encrypted text component, modify it to use it on the title. The underneath it for the description have it say "Developed by Pranav Maringanti" and have Pranav Maringanti in another color slightly bolder, the subtext should also be in a techy font. If you hover over my name, it should give you a tooltip using the existing tooltip component I have added to open a tooltip with my github, linked in, resume, and website all linked (add arbitrary links for now). The under those components add a new component that I have also already implimented called sticky input, and for the pretext have "Enter website URL". Have some subtext under the input bar component reading "Add a URL to parse through and scan for falso information" in a smaller and more discrete techy format. Expanding on the background, the dots should be darker black contrasting and they should use the motion library and smoothly interact with the user while they move their mouse around. when the user clicks anywhere (including on another component) the dots should replicate a smooth synchronouse ripple like effect spanning the entire page. It should look very bubly and animated, ensure to use the motion library to accurately add these animations to the background dots.
