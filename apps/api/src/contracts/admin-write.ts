// The admin write contracts live in packages/shared so the admin frontend validates its
// requests and the responses with exactly the same schemas. Re-exported here so backend
// imports stay unchanged.
export * from "@autowascenter/shared/admin-write";
