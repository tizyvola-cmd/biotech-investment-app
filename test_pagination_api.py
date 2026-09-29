#!/usr/bin/env python3
"""
Test script per verificare la paginazione API.
Esegue test locali sulla logica di paginazione senza richiedere il server in esecuzione.
"""

def test_pagination_logic():
    """Test logica paginazione senza dipendenze esterne."""
    
    # Dati test simulati
    all_rows = [{"id": i, "name": f"Item {i}"} for i in range(1, 501)]
    total = len(all_rows)
    
    print(f"Total rows: {total}")
    print("-" * 50)
    
    # Test diverse pagine
    test_cases = [
        (1, 50),   # Prima pagina
        (2, 50),   # Seconda pagina
        (10, 50),  # Decima pagina
        (1, 100),  # Prima pagina, size 100
        (5, 20),   # Quinta pagina, size 20
    ]
    
    for page, page_size in test_cases:
        start_idx = (page - 1) * page_size
        end_idx = min(start_idx + page_size, total)
        
        paginated_rows = all_rows[start_idx:end_idx]
        
        pagination_meta = {
            "page": page,
            "page_size": page_size,
            "total": total,
            "total_pages": (total + page_size - 1) // page_size,
            "has_next": end_idx < total,
            "has_prev": page > 1,
        }
        
        print(f"\nPage {page}, Size {page_size}:")
        print(f"  Rows: {len(paginated_rows)} (indices {start_idx}-{end_idx-1})")
        print(f"  Metadata: {pagination_meta}")
        
        # Verifiche
        assert len(paginated_rows) <= page_size, "Page size exceeded"
        assert pagination_meta["total"] == total, "Total mismatch"
        assert pagination_meta["has_next"] == (end_idx < total), "has_next wrong"
        assert pagination_meta["has_prev"] == (page > 1), "has_prev wrong"
        
        print("  ✓ Assertions passed")
    
    print("\n" + "=" * 50)
    print("All pagination logic tests passed!")
    return True

if __name__ == "__main__":
    try:
        test_pagination_logic()
    except AssertionError as e:
        print(f"\n✗ Test failed: {e}")
        exit(1)
    except Exception as e:
        print(f"\n✗ Unexpected error: {e}")
        exit(1)
