-- Replay shim for pgvector. Provides ONLY what the Ktebli migrations need: a type
-- named `vector` that accepts a typmod, so `vector(1536)` parses and the column
-- definitions replay. It borrows varchar's internal I/O and typmod handlers; it has
-- none of pgvector's behaviour, distance operators or index support.
--
-- Vector columns are therefore excluded from the column fingerprint -- which is why
-- that fingerprint category is named columns_nonvector.
create type vector;

create function vector_in(cstring, oid, integer) returns vector
  as 'varcharin' language internal immutable strict;
create function vector_out(vector) returns cstring
  as 'varcharout' language internal immutable strict;

create type vector (
  input = vector_in,
  output = vector_out,
  typmod_in = varchartypmodin,
  typmod_out = varchartypmodout,
  internallength = variable,
  storage = extended,
  category = 'S'
);
