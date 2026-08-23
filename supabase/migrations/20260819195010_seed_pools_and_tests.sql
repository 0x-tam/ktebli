-- seed the structural template and opening device pools (LOCK 3 needs real inventory)
insert into public.structural_templates (name, description) values
 ('problem_first', 'Opens on the problem evidence, builds to the intervention, ends on sustainability'),
 ('story_first', 'Opens on one person or one incident, widens to the systemic problem, then the response'),
 ('outcomes_first', 'Leads with the end-state and works backwards through how each activity produces it'),
 ('capacity_first', 'Leads with the organisation''s track record and positions the project as its natural next step'),
 ('geography_first', 'Organised around the places served; each area gets its needs, activities and targets'),
 ('question_led', 'Frames the proposal as answers to the questions the donor''s guidelines actually pose'),
 ('timeline_led', 'Organised as phases; each phase carries its own objectives, activities and indicators'),
 ('partnership_led', 'Structured around the actors and what each contributes, with the applicant as convenor');

insert into public.opening_devices (name, description) values
 ('incident', 'A dated, real event that makes the problem concrete'),
 ('statistic', 'One striking verified number, then what it means locally'),
 ('voice', 'A quoted line from a beneficiary or field worker'),
 ('place', 'A specific town or district described at street level'),
 ('contrast', 'Before and after, or two neighbouring realities side by side'),
 ('question', 'The exact question the project answers, asked plainly'),
 ('mandate', 'The organisation''s founding moment tied to this grant''s purpose'),
 ('policy_moment', 'A recent law, ceasefire, or policy shift that makes now the moment');